import { useRef, useCallback, useState } from 'react'
import type { BlinkData } from './useBlinkDetector'

// Document Picture-in-Picture API 类型声明
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>
      window: Window | null
    }
  }
}

/**
 * 全局监测模式（Picture-in-Picture）
 *
 * 将整个眨眼检测管线（摄像头 + MediaPipe + EAR算法）搬进 PiP 悬浮窗，
 * 使其在切换到其他应用时仍能持续运行。
 *
 * 数据通过 postMessage 从 PiP 窗口回传给主页面。
 */

interface GlobalModeOptions {
  /** 获取最新的眨眼数据（主页面用） */
  getBlinkData: () => BlinkData
  /** 标定数据 */
  calibration?: { openEAR: number; closedEAR: number }
  /** 自定义阈值 */
  threshold?: number
  /** 眨眼回调 */
  onBlink?: () => void
  /** 频率变化回调 */
  onBlinkRateChange?: (rate: number) => void
}

// ===== 纯函数：从 useBlinkDetector 提取的算法逻辑 =====

const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380]

function calculateEAR(landmarks: { x: number; y: number }[], indices: number[]): number {
  const p = indices.map(i => landmarks[i])
  const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y)
  const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y)
  const h = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y)
  return (v1 + v2) / (2 * h)
}

// 在 PiP 窗口内部运行完整的检测管线 + 渲染
async function runPiPDetection(
  pipWindow: Window,
  opts: {
    calibration?: { openEAR: number; closedEAR: number }
    threshold?: number
    isActiveRef: { current: boolean }
    onBlink: () => void
    onBlinkRateChange: (rate: number) => void
    onShutdown: () => void
  }
) {
  const doc = pipWindow.document
  const { isActiveRef, onBlink, onBlinkRateChange, onShutdown } = opts

  // ===== 1. 设置 PiP 页面结构 =====
  doc.body.style.margin = '0'
  doc.body.style.background = '#111'
  doc.body.style.overflow = 'hidden'

  // 创建隐藏的 video 元素（摄像头输入）
  const video = doc.createElement('video')
  video.playsInline = true
  video.muted = true
  video.autoplay = true
  video.style.display = 'none'
  doc.body.appendChild(video)

  // 创建渲染用的 canvas
  const canvas = doc.createElement('canvas')
  canvas.width = 320
  canvas.height = 260
  const ctx = canvas.getContext('2d')!
  doc.body.appendChild(canvas)

  // ===== 2. 加载 MediaPipe 库 =====
  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = doc.createElement('script')
      script.src = src
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Failed to load ${src}`))
      doc.head.appendChild(script)
    })
  }

  try {
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js')
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js')
  } catch (err) {
    ctx.fillStyle = '#ef4444'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('MediaPipe 加载失败', canvas.width / 2, canvas.height / 2)
    return
  }

  // 等 FaceMesh/Camera 注册到全局
  const pipWin = pipWindow as any
  let attempts = 0
  while ((!pipWin.FaceMesh || !pipWin.Camera) && attempts < 50) {
    await new Promise(r => setTimeout(r, 100))
    attempts++
  }

  if (!pipWin.FaceMesh || !pipWin.Camera) {
    ctx.fillStyle = '#ef4444'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('MediaPipe 库加载超时', canvas.width / 2, canvas.height / 2)
    return
  }

  // ===== 3. 初始化摄像头 =====
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
    })
    video.srcObject = stream
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject)
      }
      setTimeout(() => reject(new Error('video timeout')), 10000)
    })
  } catch (err) {
    ctx.fillStyle = '#ef4444'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('摄像头启动失败', canvas.width / 2, canvas.height / 2)
    return
  }

  // ===== 4. 初始化 FaceMesh =====
  const faceMesh = new pipWin.FaceMesh({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  })

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })

  // ===== 5. 眨眼检测状态 =====
  const BLINK_COOLDOWN_MS = 300
  const FRAME_INTERVAL = 1000 / 10 // 10fps
  const SMOOTH_WINDOW = 2
  const BASELINE_WINDOW = 50
  const BASELINE_DROP_RATIO = 0.12
  const ABSOLUTE_FALLBACK = 0.38

  let detectionMode: 'absolute' | 'calibrated' | 'adaptive' = 'adaptive'
  let effectiveThreshold = ABSOLUTE_FALLBACK

  if (opts.threshold) {
    detectionMode = 'calibrated'
    effectiveThreshold = opts.threshold
  } else if (opts.calibration?.openEAR && opts.calibration?.closedEAR) {
    detectionMode = 'calibrated'
    const gap = opts.calibration.openEAR - opts.calibration.closedEAR
    effectiveThreshold = opts.calibration.closedEAR + gap * 0.35
  }

  const state = {
    earHistory: [] as number[],
    baselineHistory: [] as number[],
    isEyeClosed: false,
    totalBlinks: 0,
    blinkTimestamps: [] as number[],
    lastProcessTime: 0,
    lastBlinkTime: 0,
  }

  // 当前眨眼数据
  let blinkData: BlinkData = {
    isBlinking: false,
    blinkCount: 0,
    blinkRate: 0,
    lastBlinkTime: null,
    eyeOpenness: 1,
    rawEar: 0.5,
  }

  // 历史数据（用于绘制曲线）
  interface HistoryPoint { time: number; rate: number }
  const history: HistoryPoint[] = []
  let lastHistoryTime = 0

  // ===== 6. 处理检测结果 =====
  faceMesh.onResults((results: any) => {
    if (!isActiveRef.current || pipWindow.closed) return

    const now = Date.now()

    // 帧率控制
    if (now - state.lastProcessTime < FRAME_INTERVAL) return
    state.lastProcessTime = now

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return

    const landmarks = results.multiFaceLandmarks[0]

    // 计算 EAR
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES)
    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES)
    const rawEAR = (leftEAR + rightEAR) / 2

    // 平滑
    state.earHistory.push(rawEAR)
    if (state.earHistory.length > SMOOTH_WINDOW) state.earHistory.shift()
    const smoothedEAR = state.earHistory.reduce((a, b) => a + b, 0) / state.earHistory.length

    // 判断闭眼
    let isCurrentlyClosed: boolean
    let currentBaseline = 0

    if (detectionMode === 'adaptive') {
      state.baselineHistory.push(rawEAR)
      if (state.baselineHistory.length > BASELINE_WINDOW) state.baselineHistory.shift()
      const sorted = [...state.baselineHistory].sort((a, b) => a - b)
      currentBaseline = sorted[Math.floor(sorted.length * 0.6)]
      isCurrentlyClosed = smoothedEAR < currentBaseline * (1 - BASELINE_DROP_RATIO)
    } else {
      isCurrentlyClosed = smoothedEAR < effectiveThreshold
      currentBaseline = effectiveThreshold / (1 - BASELINE_DROP_RATIO)
    }

    const openness = Math.min(1, Math.max(0, smoothedEAR))

    // 边缘检测 → 眨眼
    let isBlinking = false
    if (isCurrentlyClosed && !state.isEyeClosed) {
      if (!state.lastBlinkTime || now - state.lastBlinkTime > BLINK_COOLDOWN_MS) {
        state.totalBlinks++
        isBlinking = true
        state.lastBlinkTime = now
        state.blinkTimestamps.push(now)
        onBlink()
      }
      state.isEyeClosed = true
    } else if (!isCurrentlyClosed && state.isEyeClosed) {
      state.isEyeClosed = false
    }

    // 清理过期记录
    state.blinkTimestamps = state.blinkTimestamps.filter(t => now - t < 60000)
    const blinkRate = state.blinkTimestamps.length

    if (blinkRate !== blinkData.blinkRate) {
      onBlinkRateChange(blinkRate)
    }

    blinkData = {
      isBlinking,
      blinkCount: state.totalBlinks,
      blinkRate,
      lastBlinkTime: isBlinking ? now : blinkData.lastBlinkTime,
      eyeOpenness: openness,
      rawEar: rawEAR,
      baseline: currentBaseline,
    }

    // 记录历史点
    if (now - lastHistoryTime > 1000) {
      history.push({ time: now, rate: blinkRate })
      if (history.length > 60) history.shift()
      lastHistoryTime = now
    }
  })

  // ===== 7. 启动 Camera =====
  const camera = new pipWin.Camera(video, {
    onFrame: async () => {
      try { await faceMesh.send({ image: video }) } catch { /* ignore */ }
    },
    width: 320,
    height: 240,
  })

  try {
    await camera.start()
  } catch {
    ctx.fillStyle = '#ef4444'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('Camera 启动失败', canvas.width / 2, canvas.height / 2)
    return
  }

  // ===== 8. 渲染循环 =====
  const CHART_TOP = 8
  const CHART_LEFT = 36
  const CHART_RIGHT = canvas.width - 12
  const CHART_BOTTOM = 150
  const CHART_WIDTH = CHART_RIGHT - CHART_LEFT
  const CHART_HEIGHT = CHART_BOTTOM - CHART_TOP
  const STATUS_Y = CHART_BOTTOM + 16
  const Y_MAX = 30

  const render = () => {
    if (!isActiveRef.current || pipWindow.closed) {
      onShutdown()
      return
    }

    const data = blinkData

    // 清空背景
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 标题栏
    ctx.fillStyle = '#444'
    ctx.font = '9px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('BLINK GUARDIAN', 12, 18)
    ctx.textAlign = 'right'
    ctx.fillText('GLOBAL', canvas.width - 12, 18)

    // 图表区域背景
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(CHART_LEFT, CHART_TOP, CHART_WIDTH, CHART_HEIGHT)

    // Y轴刻度
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 0.5
    for (let v = 0; v <= Y_MAX; v += 10) {
      const y = CHART_BOTTOM - (v / Y_MAX) * CHART_HEIGHT
      ctx.beginPath()
      ctx.moveTo(CHART_LEFT, y)
      ctx.lineTo(CHART_RIGHT, y)
      ctx.stroke()

      ctx.fillStyle = '#555'
      ctx.font = '8px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(String(v), CHART_LEFT - 4, y + 3)
    }

    // 参考区域
    ctx.fillStyle = 'rgba(16, 185, 129, 0.06)'
    const nyTop = CHART_BOTTOM - (25 / Y_MAX) * CHART_HEIGHT
    const nyBot = CHART_BOTTOM - (15 / Y_MAX) * CHART_HEIGHT
    ctx.fillRect(CHART_LEFT, nyTop, CHART_WIDTH, Math.max(1, nyBot - nyTop))

    ctx.fillStyle = 'rgba(245, 158, 11, 0.05)'
    const wyTop = CHART_BOTTOM - (15 / Y_MAX) * CHART_HEIGHT
    const wyBot = CHART_BOTTOM - (10 / Y_MAX) * CHART_HEIGHT
    ctx.fillRect(CHART_LEFT, wyTop, CHART_WIDTH, Math.max(1, wyBot - wyTop))

    // 曲线
    if (history.length >= 2) {
      ctx.beginPath()
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      for (let i = 0; i < history.length; i++) {
        const x = CHART_LEFT + (i / (history.length - 1)) * CHART_WIDTH
        const cr = Math.min(history[i].rate, Y_MAX)
        const y = CHART_BOTTOM - (cr / Y_MAX) * CHART_HEIGHT
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // 当前点圆圈
      const lx = CHART_LEFT + ((history.length - 1) / Math.max(history.length - 1, 1)) * CHART_WIDTH
      const lc = Math.min(data.blinkRate, Y_MAX)
      const ly = CHART_BOTTOM - (lc / Y_MAX) * CHART_HEIGHT
      ctx.beginPath()
      ctx.arc(lx, ly, 4, 0, 2 * Math.PI)
      ctx.fillStyle = data.blinkRate < 8 ? '#ef4444' : data.blinkRate < 12 ? '#f59e0b' : '#10b981'
      ctx.fill()
    }

    // 分隔线
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(12, STATUS_Y - 2)
    ctx.lineTo(canvas.width - 12, STATUS_Y - 2)
    ctx.stroke()

    // 左侧眼睛图标
    const eyeX = 20
    const eyeY = STATUS_Y + 14
    const iconSize = 22
    ctx.strokeStyle = data.isBlinking ? '#f59e0b' : '#10b981'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    if (data.isBlinking) {
      ctx.arc(eyeX + iconSize / 2, eyeY + iconSize / 2, iconSize / 2 - 2, 0.2 * Math.PI, 0.8 * Math.PI)
    } else {
      ctx.arc(eyeX + iconSize / 2, eyeY + iconSize / 2, iconSize / 2 - 2, 0, 2 * Math.PI)
    }
    ctx.stroke()

    // 状态文字
    const statusText = data.isBlinking ? 'BLINK' : data.blinkRate < 8 ? 'LOW' : data.blinkRate < 12 ? 'WARN' : 'OK'
    ctx.fillStyle = data.isBlinking ? '#f59e0b' : data.blinkRate < 8 ? '#ef4444' : data.blinkRate < 12 ? '#f59e0b' : '#10b981'
    ctx.font = 'bold 13px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(statusText, eyeX + iconSize + 10, eyeY + iconSize / 2 + 5)

    // BPM 大数字
    ctx.fillStyle = data.blinkRate < 8 ? '#ef4444' : data.blinkRate < 12 ? '#f59e0b' : '#10b981'
    ctx.font = 'bold 40px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(String(Math.round(data.blinkRate)), canvas.width / 2, STATUS_Y + 50)
    ctx.fillStyle = '#666'
    ctx.font = '11px monospace'
    ctx.fillText('BPM', canvas.width / 2, STATUS_Y + 64)

    // 眨眼次数
    ctx.fillStyle = '#888'
    ctx.font = '9px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`#${data.blinkCount}`, canvas.width - 12, STATUS_Y + 24)

    // 向主页面 postMessage 更新数据
    try {
      window.postMessage({ type: 'BLINK_GUARDIAN_UPDATE', data: blinkData }, '*')
    } catch { /* ignore cross-origin issues */ }

    requestAnimationFrame(render)
  }

  // 开始渲染
  requestAnimationFrame(render)
}

// ===== React Hook =====

export function useGlobalMode(options: GlobalModeOptions) {
  const [isActive, setIsActive] = useState(false)
  const pipWindowRef = useRef<Window | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const isActiveRef = useRef(false) // 非 React state 的 ref，供 PiP 内部读取

  // 开启全局模式
  const enableGlobalMode = useCallback(async () => {
    if (!('documentPictureInPicture' in window)) {
      alert('您的浏览器不支持全局悬浮窗功能。\n请使用 Chrome 116+ 或 Edge 116+。')
      return false
    }

    try {
      const pipWindow = await window.documentPictureInPicture!.requestWindow({
        width: 320,
        height: 260,
      })

      pipWindowRef.current = pipWindow
      isActiveRef.current = true
      setIsActive(true)

      // 监听窗口关闭
      pipWindow.addEventListener('pagehide', () => {
        disableGlobalMode()
      })

      // 获取标定数据
      let calData: { openEAR: number; closedEAR: number } | undefined
      try {
        const stored = localStorage.getItem('blinkGuardian_calibration')
        if (stored) calData = JSON.parse(stored)
      } catch { /* ignore */ }

      // 在 PiP 内启动完整检测管线
      runPiPDetection(pipWindow, {
        calibration: options.calibration ?? calData,
        threshold: options.threshold,
        isActiveRef,
        onBlink: () => options.onBlink?.(),
        onBlinkRateChange: (rate) => options.onBlinkRateChange?.(rate),
        onShutdown: () => {
          disableGlobalMode()
        },
      })

      // Screen Wake Lock
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen')
        }
      } catch { /* ignore */ }

      return true
    } catch (err) {
      console.error('Failed to enter global mode:', err)
      return false
    }
  }, [options])

  // 关闭全局模式
  const disableGlobalMode = useCallback(() => {
    isActiveRef.current = false

    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close()
    }
    pipWindowRef.current = null

    ;(async () => {
      try { await wakeLockRef.current?.release() } catch { /* ignore */ }
      wakeLockRef.current = null
    })()

    setIsActive(false)
  }, [])

  // 切换
  const toggleGlobalMode = useCallback(async () => {
    if (isActive) {
      disableGlobalMode()
      return false
    } else {
      return await enableGlobalMode()
    }
  }, [enableGlobalMode, disableGlobalMode, isActive])

  return {
    isGlobalActive: isActive,
    toggleGlobalMode,
    disableGlobalMode,
  }
}
