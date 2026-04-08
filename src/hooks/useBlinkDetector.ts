import { useEffect, useRef, useCallback, useState } from 'react'

// MediaPipe 类型定义（UMD 格式，从 window 对象访问）
type Results = {
  multiFaceLandmarks?: { x: number; y: number; z: number }[][]
}

type FaceMesh = {
  setOptions: (options: {
    maxNumFaces?: number
    refineLandmarks?: boolean
    minDetectionConfidence?: number
    minTrackingConfidence?: number
  }) => void
  onResults: (callback: (results: Results) => void) => void
  send: (input: { image: HTMLVideoElement }) => Promise<void>
  close: () => void
}

type Camera = {
  start: () => Promise<void>
  stop: () => void
}

declare global {
  interface Window {
    FaceMesh: new (config: { locateFile: (file: string) => string }) => FaceMesh
    Camera: new (
      videoElement: HTMLVideoElement,
      config: {
        onFrame: () => Promise<void>
        width: number
        height: number
      }
    ) => Camera
  }
}

// EAR (Eye Aspect Ratio) 计算
// 使用 6 个眼部关键点：左眼 [33, 160, 158, 133, 153, 144]，右眼 [362, 385, 387, 263, 373, 380]
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380]

function calculateEAR(landmarks: { x: number; y: number }[], indices: number[]): number {
  const p = indices.map(i => landmarks[i])
  // 垂直距离
  const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y)
  const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y)
  // 水平距离
  const h = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y)
  return (v1 + v2) / (2 * h)
}

export type BlinkData = {
  isBlinking: boolean
  blinkCount: number
  blinkRate: number // 每分钟眨眼次数
  lastBlinkTime: number | null
  eyeOpenness: number // 0-1，眼睛张开程度
}

interface UseBlinkDetectorOptions {
  onBlink?: () => void
  onBlinkRateChange?: (rate: number) => void
}

export function useBlinkDetector(options: UseBlinkDetectorOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const faceMeshRef = useRef<FaceMesh | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blinkData, setBlinkData] = useState<BlinkData>({
    isBlinking: false,
    blinkCount: 0,
    blinkRate: 0,
    lastBlinkTime: null,
    eyeOpenness: 1,
  })
  
  // 眨眼检测状态
  const blinkStateRef = useRef({
    earHistory: [] as number[],
    isEyeClosed: false,
    blinkTimestamps: [] as number[],
    lastProcessTime: 0,
  })
  
  const EAR_THRESHOLD = 0.2 // 闭眼阈值
  const EAR_CONSEC_FRAMES = 2 // 连续帧数确认眨眼
  const BLINK_WINDOW_MS = 60000 // 1分钟窗口计算频率
  const TARGET_FPS = 5 // 目标检测帧率
  const FRAME_INTERVAL = 1000 / TARGET_FPS
  
  const processResults = useCallback((results: Results) => {
    const now = Date.now()
    const state = blinkStateRef.current
    
    // 帧率控制
    if (now - state.lastProcessTime < FRAME_INTERVAL) return
    state.lastProcessTime = now
    
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      setBlinkData(prev => ({ ...prev, eyeOpenness: 0 }))
      return
    }
    
    const landmarks = results.multiFaceLandmarks[0]
    
    // 计算双眼 EAR
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES)
    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES)
    const avgEAR = (leftEAR + rightEAR) / 2
    
    // 更新历史
    state.earHistory.push(avgEAR)
    if (state.earHistory.length > 10) state.earHistory.shift()
    
    // 平滑处理
    const smoothedEAR = state.earHistory.reduce((a, b) => a + b, 0) / state.earHistory.length
    
    // 眼睛张开程度 (0-1)
    const openness = Math.min(1, Math.max(0, (smoothedEAR - 0.1) / 0.3))
    
    // 眨眼检测
    const isCurrentlyClosed = smoothedEAR < EAR_THRESHOLD
    const closedFrameCount = state.earHistory.filter(e => e < EAR_THRESHOLD).length
    
    let newBlinkCount = blinkData.blinkCount
    let isBlinking = false
    
    if (isCurrentlyClosed && closedFrameCount >= EAR_CONSEC_FRAMES && !state.isEyeClosed) {
      // 开始闭眼
      state.isEyeClosed = true
    } else if (!isCurrentlyClosed && state.isEyeClosed) {
      // 睁眼 = 完成一次眨眼
      state.isEyeClosed = false
      newBlinkCount++
      isBlinking = true
      state.blinkTimestamps.push(now)
      options.onBlink?.()
    }
    
    // 清理过期眨眼记录（1分钟前）
    state.blinkTimestamps = state.blinkTimestamps.filter(t => now - t < BLINK_WINDOW_MS)
    const blinkRate = state.blinkTimestamps.length
    
    // 频率变化回调
    if (blinkRate !== blinkData.blinkRate) {
      options.onBlinkRateChange?.(blinkRate)
    }
    
    setBlinkData({
      isBlinking,
      blinkCount: newBlinkCount,
      blinkRate,
      lastBlinkTime: isBlinking ? now : blinkData.lastBlinkTime,
      eyeOpenness: openness,
    })
  }, [blinkData.blinkCount, blinkData.blinkRate, blinkData.lastBlinkTime, options])
  
  // 初始化 FaceMesh
  useEffect(() => {
    if (!videoRef.current || faceMeshRef.current) return
    
    // 等待 MediaPipe 库加载
    const waitForMediaPipe = async () => {
      let attempts = 0
      const maxAttempts = 50 // 最多等待 5 秒
      
      while ((!window.FaceMesh || !window.Camera) && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
      }
      
      if (!window.FaceMesh || !window.Camera) {
        setError('MediaPipe 库加载超时，请检查网络连接后刷新页面')
        return false
      }
      return true
    }
    
    const init = async () => {
      const loaded = await waitForMediaPipe()
      if (!loaded) return
    
    const faceMesh = new window.FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      }
    })
    
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    
    faceMesh.onResults(processResults)
    faceMeshRef.current = faceMesh
    
    // 初始化相机
    const video = videoRef.current
    if (!video) return
    
    const camera = new window.Camera(video, {
      onFrame: async () => {
        await faceMesh.send({ image: video })
      },
      width: 320,
      height: 240,
    })
    
    cameraRef.current = camera
    
    // 启动相机
    camera.start()
      .then(() => {
        setIsInitialized(true)
        setError(null)
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : '相机启动失败'
        if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
          setError('相机权限被拒绝。请点击浏览器地址栏的相机图标，选择"允许"。')
        } else if (errorMsg.includes('NotFoundError') || errorMsg.includes('DevicesNotFoundError')) {
          setError('未找到摄像头设备。请确保摄像头已连接。')
        } else {
          setError(`${errorMsg}。请检查摄像头权限后刷新页面。`)
        }
        setIsInitialized(false)
      })
    
    // 页面可见性变化处理
    const handleVisibilityChange = () => {
      if (document.hidden) {
        cameraRef.current?.stop()
      } else {
        cameraRef.current?.start()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      cameraRef.current?.stop()
      faceMeshRef.current?.close()
      faceMeshRef.current = null
    }
    }
    
    init()
  }, [processResults])
  
  return {
    videoRef,
    isInitialized,
    error,
    blinkData,
  }
}
