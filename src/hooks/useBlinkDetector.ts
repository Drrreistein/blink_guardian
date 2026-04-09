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
  baseline?: number   // 当前基线 EAR（调试用）
}

interface UseBlinkDetectorOptions {
  onBlink?: () => void
  onBlinkRateChange?: (rate: number) => void
  /** 个性化阈值，可选。不传则使用自适应基线检测 */
  threshold?: number
  /** 标定结果：睁眼和闭眼的平均 EAR，用于自动计算最佳阈值 */
  calibration?: { openEAR: number; closedEAR: number }
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

  // ===== 算法参数 =====
  const BLINK_COOLDOWN_MS = 300       // 防抖冷却时间（两次眨眼最小间隔）
  const TARGET_FPS = 10               // 处理帧率
  const FRAME_INTERVAL = 1000 / TARGET_FPS
  const SMOOTH_WINDOW = 2             // 平滑窗口帧数（2帧=200ms，足够捕捉~150ms的眨眼）

  // 自适应基线参数
  const BASELINE_WINDOW = 50          // 基线采样窗口（5秒@10fps）
  const BASELINE_DROP_RATIO = 0.12    // 相对基线下降多少比例算闭眼（默认12%）
  const ABSOLUTE_FALLBACK = 0.38      // 无标定数据时的绝对阈值兜底

  // 计算实际使用的阈值策略
  let detectionMode: 'absolute' | 'calibrated' | 'adaptive' = 'adaptive'
  let effectiveThreshold: number = ABSOLUTE_FALLBACK

  if (options.threshold) {
    detectionMode = 'calibrated'
    effectiveThreshold = options.threshold
  } else if (options.calibration?.openEAR && options.calibration?.closedEAR) {
    // 从标定数据计算阈值：闭眼值 + 差值*35%
    detectionMode = 'calibrated'
    const gap = options.calibration.openEAR - options.calibration.closedEAR
    effectiveThreshold = options.calibration.closedEAR + gap * 0.35
  } else {
    detectionMode = 'adaptive'
  }

  // 眨眼检测状态（全部用 ref 存储，避免闭包陈旧数据问题）
  const blinkStateRef = useRef({
    earHistory: [] as number[],
    baselineHistory: [] as number[],   // 用于自适应基线的滚动窗口
    isEyeClosed: false,
    totalBlinks: 0,
    blinkTimestamps: [] as number[],
    lastProcessTime: 0,
    lastBlinkTime: 0,
  })

  const processResults = useCallback((results: Results) => {
    const now = Date.now()
    const state = blinkStateRef.current

    // 帧率控制
    if (now - state.lastProcessTime < FRAME_INTERVAL) return
    state.lastProcessTime = now

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      // 未检测到人脸，冻结所有眨眼数据，不更新任何值
      return
    }

    const landmarks = results.multiFaceLandmarks[0]

    // 计算双眼原始 EAR
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES)
    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES)
    const rawEAR = (leftEAR + rightEAR) / 2

    // 轻度平滑（2帧窗口 = 200ms）
    state.earHistory.push(rawEAR)
    if (state.earHistory.length > SMOOTH_WINDOW) state.earHistory.shift()
    const smoothedEAR = state.earHistory.reduce((a, b) => a + b, 0) / state.earHistory.length

    // ===== 判断是否闭眼 =====
    let isCurrentlyClosed: boolean
    let currentBaseline: number = 0

    if (detectionMode === 'adaptive') {
      // 自适应模式：维护一个缓慢更新的基线，用相对下降判断
      // 将当前 EAR 加入基线历史
      state.baselineHistory.push(rawEAR)
      if (state.baselineHistory.length > BASELINE_WINDOW) state.baselineHistory.shift()

      // 基线取历史的中位数（抗噪比均值更好）
      const sorted = [...state.baselineHistory].sort((a, b) => a - b)
      currentBaseline = sorted[Math.floor(sorted.length * 0.6)]  // 取60th percentile（偏高的值代表睁眼状态）

      // 相对下降判断
      isCurrentlyClosed = smoothedEAR < currentBaseline * (1 - BASELINE_DROP_RATIO)
    } else {
      // 绝对/标定模式：用固定阈值
      isCurrentlyClosed = smoothedEAR < effectiveThreshold
      currentBaseline = effectiveThreshold / (1 - BASELINE_DROP_RATIO) // 反推用于显示
    }

    // 眼睛张开程度 (0-1)
    const openness = Math.min(1, Math.max(0, smoothedEAR))

    // 边缘检测：从睁→闭的变化 = 一次眨眼
    let isBlinking = false
    if (isCurrentlyClosed && !state.isEyeClosed) {
      if (!state.lastBlinkTime || (now - state.lastBlinkTime > BLINK_COOLDOWN_MS)) {
        state.totalBlinks++
        isBlinking = true
        state.lastBlinkTime = now
        state.blinkTimestamps.push(now)
        options.onBlink?.()
      }
      state.isEyeClosed = true
    } else if (!isCurrentlyClosed && state.isEyeClosed) {
      state.isEyeClosed = false
    }

    // 清理过期眨眼记录（1分钟窗口）
    state.blinkTimestamps = state.blinkTimestamps.filter(t => now - t < 60000)
    const blinkRate = state.blinkTimestamps.length

    // 频率变化回调
    const prevRate = blinkData.blinkRate
    if (blinkRate !== prevRate) {
      options.onBlinkRateChange?.(blinkRate)
    }

    setBlinkData({
      isBlinking,
      blinkCount: state.totalBlinks,
      blinkRate,
      lastBlinkTime: isBlinking ? now : blinkData.lastBlinkTime,
      eyeOpenness: openness,
      rawEar: rawEAR,
      baseline: currentBaseline,
    })
  }, [blinkData.blinkRate, blinkData.lastBlinkTime, options, detectionMode, effectiveThreshold])

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
    // 暴露当前配置供 UI 显示
    config: {
      mode: detectionMode,
      threshold: detectionMode === 'adaptive' ? undefined : effectiveThreshold,
      dropRatio: detectionMode === 'adaptive' ? BASELINE_DROP_RATIO : undefined,
    },
  }
}
