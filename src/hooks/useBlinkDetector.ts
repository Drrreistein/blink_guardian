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
  rawEar: number      // 原始 EAR 值 (用于调试)
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
    rawEar: 0.5,
  })
  
  // 眨眼检测状态
  const blinkStateRef = useRef({
    earHistory: [] as number[],
    isEyeClosed: false,
    blinkTimestamps: [] as number[],
    lastProcessTime: 0,
    lastBlinkTime: 0,
  })
  
  const EAR_THRESHOLD = 0.4       // 闭眼阈值
  const BLINK_COOLDOWN_MS = 300     // 防抖冷却时间（两次眨眼最小间隔）
  const TARGET_FPS = 10             // 提高帧率到10FPS
  const FRAME_INTERVAL = 1000 / TARGET_FPS
  
  const processResults = useCallback((results: Results) => {
    const now = Date.now()
    const state = blinkStateRef.current
    
    // 帧率控制
    if (now - state.lastProcessTime < FRAME_INTERVAL) return
    state.lastProcessTime = now
    
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      setBlinkData(prev => ({ 
        ...prev, 
        eyeOpenness: 0,
        rawEar: 0,
      }))
      return
    }
    
    const landmarks = results.multiFaceLandmarks[0]
    
    // 计算双眼原始 EAR
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES)
    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES)
    const rawEAR = (leftEAR + rightEAR) / 2
    
    // 轻度平滑：只取最近3帧平均（眨眼~150ms，3帧@10fps=300ms足够捕捉）
    state.earHistory.push(rawEAR)
    if (state.earHistory.length > 3) state.earHistory.shift()
    
    const smoothedEAR = state.earHistory.reduce((a, b) => a + b, 0) / state.earHistory.length
    
    // 眼睛张开程度 (0-1)，直接用原始值映射
    const openness = Math.min(1, Math.max(0, smoothedEAR))
    
    // 简化检测逻辑：
    // 1. 当前帧 EAR < 阈值 → 记为闭眼
    // 2. 从睁眼状态变为闭眼状态 + 冷却时间已过 → 检测到一次眨眼
    const isCurrentlyClosed = smoothedEAR < EAR_THRESHOLD
    let newBlinkCount = blinkData.blinkCount
    let isBlinking = false
    
    // 简单的边缘检测：从睁→闭的变化 = 一次眨眼
    if (isCurrentlyClosed && !state.isEyeClosed) {
      // 检查冷却时间，防止重复计数
      if (!state.lastBlinkTime || (now - state.lastBlinkTime > BLINK_COOLDOWN_MS)) {
        newBlinkCount++
        isBlinking = true
        state.lastBlinkTime = now
        state.blinkTimestamps.push(now)
        options.onBlink?.()
      }
      state.isEyeClosed = true
    } else if (!isCurrentlyClosed && state.isEyeClosed) {
      // 省略恢复睁眼的处理
      state.isEyeClosed = false
    }
    
    // 清理过期眨眼记录（1分钟窗口）
    state.blinkTimestamps = state.blinkTimestamps.filter(t => now - t < 60000)
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
      rawEar: rawEAR,
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
      
      // 先请求摄像头权限（这会触发浏览器权限弹窗）
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 320 },
            height: { ideal: 240 },
            facingMode: 'user'
          } 
        })
        // 将 stream 设置到 video 元素
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '相机启动失败'
        if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
          setError('相机权限被拒绝。请检查浏览器权限设置后刷新页面。')
        } else if (errorMsg.includes('NotFoundError') || errorMsg.includes('DevicesNotFoundError')) {
          setError('未找到摄像头设备。请确保摄像头已连接。')
        } else {
          setError(`${errorMsg}。请检查摄像头权限后刷新页面。`)
        }
        setIsInitialized(false)
        return
      }
    
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
      
      // 初始化 MediaPipe Camera（使用已授权的 stream）
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
      try {
        await camera.start()
        setIsInitialized(true)
        setError(null)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '相机启动失败'
        setError(`${errorMsg}。请刷新页面重试。`)
        setIsInitialized(false)
      }
    
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
