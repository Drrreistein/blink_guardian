/**
 * Camera Debug Tool v2 - 标定 + 录像 + 同步回放检测
 *
 * 功能：
 * 1. 启动摄像头
 * 2. 标定：采集睁眼/闭眼 EAR 值，计算个性化阈值
 * 3. 录制眨眼视频
 * 4. 回放分析：预计算所有帧 → 视频播放与 EAR 曲线同步显示
 */
import { useState, useRef, useCallback, useEffect } from 'react'

// ===== 常量 =====
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380]
const DEFAULT_THRESHOLD = 0.4
const BLINK_COOLDOWN_MS = 300
const RECORD_DURATION_SEC = 8
const ANALYSIS_FPS = 10

function calcEAR(landmarks: { x: number; y: number }[], indices: number[]): number {
  const p = indices.map(i => landmarks[i])
  const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y)
  const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y)
  const h = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y)
  return (v1 + v2) / (2 * h)
}

// ===== 类型 =====
interface CalibrationResult {
  openEAR: number       // 睁眼平均 EAR
  closedEAR: number     // 闭眼平均 EAR
  threshold: number    // 计算出的个性化阈值 (闭眼值 + 区间 * ratio)
  openSamples: number[]
  closedSamples: number[]
}

interface FrameResult {
  timeSec: number        // 视频时间点 (秒)
  rawEAR: number
  smoothedEAR: number
  isClosed: boolean
  isBlink: boolean
  baseline?: number      // 自适应基线值（仅 adaptive 模式）
}

// ===== 样式常量 =====
const S = {
  btn: { padding: '8px 16px', background: '#222', color: '#fff', border: '1px solid #555', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' } as React.CSSProperties,
  btnGreen: { ...({} as React.CSSProperties), padding: '8px 16px', background: '#006622', color: '#fff', border: '1px solid #555', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' },
  btnRed: { ...({} as React.CSSProperties), padding: '8px 16px', background: '#660000', color: '#fff', border: '1px solid #555', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' },
  btnBlue: { ...({} as React.CSSProperties), padding: '8px 16px', background: '#002266', color: '#fff', border: '1px solid #555', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' },
  btnAmber: { ...({} as React.CSSProperties), padding: '8px 16px', background: '#664400', color: '#fff', border: '1px solid #886600', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' },
  sectionTitle: { margin: '0 0 8px', color: '#888', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  statusBox: (error?: string | null) => ({ padding: '10px 14px', marginBottom: '12px', background: error ? '#300' : '#111', border: `1px solid ${error ? '#f00' : '#333'}`, color: error ? '#f66' : '#ccc', fontSize: '13px' }),
  placeholder: (w: number, h: number) => ({
    width: w, height: h, background: '#111',
    display: 'flex' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, color: '#555', fontSize: '12px'
  }),
}

export function CameraDebug() {
  // ===== Refs =====
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playbackVideoRef = useRef<HTMLVideoElement>(null)
  const chartCanvasRef = useRef<HTMLCanvasElement>(null)

  // 相机/录像 refs
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 标定用的实时 FaceMesh
  const calibrateFaceMeshRef = useRef<any>(null)

  // ===== UI 状态 =====
  const [status, setStatus] = useState('等待启动...')
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  // 拍照状态
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [earValue, setEarValue] = useState<number | null>(null)
  const [landmarks, setLandmarks] = useState<{ x: number; y: number }[]>([])

  // 标定状态
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null)
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [calibStep, setCalibStep] = useState<'idle' | 'open' | 'closed'>('idle')
  const [calibCountdown, setCalibCountdown] = useState(0)
  const [calibLiveEAR, setCalibLiveEAR] = useState<number[]>([])

  // 录制状态
  const [isRecording, setIsRecording] = useState(false)
  const [recordTime, setRecordTime] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)

  // 分析/回放状态
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [frameResults, setFrameResults] = useState<FrameResult[]>([])
  const [totalBlinks, setTotalBlinks] = useState(0)
  const [analysisDone, setAnalysisDone] = useState(false)
  const [currentPlayTime, setCurrentPlayTime] = useState(0) // 视频当前播放位置 (s)

  // 当前生效的阈值
  const activeThreshold = calibration?.threshold ?? DEFAULT_THRESHOLD

  const addLog = (msg: string) => {
    console.log('[Debug]', msg)
    setLogs(prev => [...prev.slice(-29), `${new Date().toLocaleTimeString()} - ${msg}`])
  }

  // ===== 工具函数：等待 MediaPipe =====
  const waitForMediaPipe = async (): Promise<boolean> => {
    let attempts = 0
    while ((!window.FaceMesh) && attempts < 50) {
      await new Promise(r => setTimeout(r, 100))
      attempts++
    }
    return !!window.FaceMesh
  }

  // ===== 1. 启动相机 =====
  const startCamera = async () => {
    try {
      setStatus('请求相机权限...')
      setError(null)
      addLog('请求相机权限')

      if (!videoRef.current) throw new Error('Video not found')

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
      })

      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      setCameraReady(true)
      setStatus('相机就绪')
      addLog('相机已启动')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStatus('错误: ' + msg)
    }
  }

  // ===== 2. 标定流程 =====
  const CALIBRATE_SAMPLES = 15   // 采样的帧数（约 1.5 秒 @ 10fps）
  const CALIBRATE_DURATION_MS = 2500 // 总采样时间

  const startCalibration = useCallback(async (type: 'open' | 'closed') => {
    if (!streamRef.current || !videoRef.current) return
    setIsCalibrating(true)
    setCalibStep(type)
    setCalibLiveEAR([])
    setError(null)

    const label = type === 'open' ? '睁眼' : '闭眼'
    setStatus(`📐 标定${label}: 请保持${label}状态... (${CALIBRATE_DURATION_MS / 1000}s)`)
    addLog(`开始标定 ${label}`)
    setCalibCountdown(Math.ceil(CALIBRATE_DURATION_MS / 1000))

    try {
      const loaded = await waitForMediaPipe()
      if (!loaded) throw new Error('MediaPipe 未加载')

      // 用新的 FaceMesh 实例做实时标定
      const fm = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      })
      fm.setOptions({
        maxNumFaces: 1, refineLandmarks: false,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      })

      calibrateFaceMeshRef.current = fm

      const samples: number[] = []
      let collected = 0
      let countdown = Math.ceil(CALIBRATE_DURATION_MS / 1000)

      fm.onResults((results: any) => {
        if (collected >= CALIBRATE_SAMPLES) return
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return

        const lm = results.multiFaceLandmarks[0]
        const leftEAR = calcEAR(lm, LEFT_EYE_INDICES)
        const rightEAR = calcEAR(lm, RIGHT_EYE_INDICES)
        const avg = (leftEAR + rightEAR) / 2
        samples.push(avg)
        collected++
        setCalibLiveEAR([...samples])
      })

      // 使用隐藏的 canvas 从 video 流中提取帧
      const tmpCanvas = document.createElement('canvas')
      tmpCanvas.width = 320
      tmpCanvas.height = 240
      const tmpCtx = tmpCanvas.getContext('2d')!

      // 倒计时
      const cdInterval = setInterval(() => {
        countdown--
        setCalibCountdown(countdown)
        if (countdown <= 0) clearInterval(cdInterval)
      }, 1000)

      // 持续发送帧给 FaceMesh
      const sendInterval = setInterval(async () => {
        if (collected >= CALIBRATE_SAMPLES || !videoRef.current) {
          clearInterval(sendInterval)
          clearInterval(cdInterval)
          return
        }
        tmpCtx.drawImage(videoRef.current!, 0, 0, 320, 240)
        await fm.send({ image: tmpCanvas as any })
      }, 80) // ~12fps

      // 等待完成
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (collected >= CALIBRATE_SAMPLES) {
            clearInterval(check)
            resolve()
          }
        }, 200)
        // 超时保护
        setTimeout(() => { clearInterval(check); resolve() }, CALIBRATE_DURATION_MS + 2000)
      })
      clearInterval(sendInterval)
      clearInterval(cdInterval)
      fm.close()
      calibrateFaceMeshRef.current = null

      if (samples.length < 3) {
        throw new Error(`仅采集到 ${samples.length} 个有效样本，请确保人脸在画面内`)
      }

      const avgEAR = samples.reduce((a, b) => a + b, 0) / samples.length
      addLog(`标定${label}完成: ${samples.length} 个样本, 平均 EAR=${avgEAR.toFixed(4)}`)

      // 更新标定结果
      setCalibration(prev => {
        const existing = prev || { openEAR: 0, closedEAR: 0, threshold: DEFAULT_THRESHOLD, openSamples: [], closedSamples: [] }
        if (type === 'open') {
          return { ...existing, openEAR: avgEAR, openSamples: samples }
        } else {
          return { ...existing, closedEAR: avgEAR, closedSamples: samples }
        }
      })
      setCalibStep('idle')
      setIsCalibrating(false)

      // 如果两边都完成了，自动计算阈值
      setCalibration(prev => {
        if (!prev) return prev
        if (prev.openEAR > 0 && prev.closedEAR > 0) {
          const gap = prev.openEAR - prev.closedEAR
          const threshold = prev.closedEAR + gap * 0.35
          const result = { ...prev, threshold }
          setStatus(`✅ 标定完成! 睁眼=${prev.openEAR.toFixed(3)} 闭眼=${prev.closedEAR.toFixed(3)} → 阈值=${threshold.toFixed(3)}`)
          addLog(`标定完成! 阈值=${threshold.toFixed(3)} (闭+区间*35%)`)
          // 持久化到 localStorage，供 MonitorWidget 使用
          try {
            localStorage.setItem('blinkguardian_calibration', JSON.stringify({ openEAR: prev.openEAR, closedEAR: prev.closedEAR }))
            addLog('已保存标定数据到本地存储')
          } catch { /* ignore */ }
          return result
        }

        setStatus(`${type === 'open' ? '睁眼' : '闭眼'}标定完成 (EAR=${avgEAR.toFixed(3)}), 请继续标定另一侧`)
        return prev
      })

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`标定失败: ${msg}`)
      setStatus('标定失败')
      addLog(`标定错误: ${msg}`)
      setIsCalibrating(false)
      setCalibStep('idle')
    }
  }, [])

  // ===== 3. 拍照 & 单帧分析 =====
  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    if (video.videoWidth === 0) { setError('视频未就绪'); return }

    const c = canvasRef.current
    c.width = video.videoWidth; c.height = video.videoHeight
    c.getContext('2d')!.drawImage(video, 0, 0)
    setPhotoDataUrl(c.toDataURL('image/jpeg', 0.8))
    addLog('拍照完成')
  }, [])

  const analyzePhoto = async () => {
    if (!canvasRef.current) return
    try {
      setStatus('分析照片中...')
      const loaded = await waitForMediaPipe()
      if (!loaded) throw new Error('MediaPipe 未加载')

      const fm = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      })
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 })

      fm.onResults((r: any) => {
        if (!r.multiFaceLandmarks?.length) { setStatus('未检测到人脸'); return }
        const lm = r.multiFaceLandmarks[0]
        setLandmarks(lm)
        const ear = (calcEAR(lm, LEFT_EYE_INDICES) + calcEAR(lm, RIGHT_EYE_INDICES)) / 2
        setEarValue(ear)
        const closed = ear < activeThreshold
        setStatus(closed ? `闭眼! EAR=${ear.toFixed(3)}` : `睁眼. EAR=${ear.toFixed(3)}`)
        addLog(`单帧: EAR=${ear.toFixed(3)}, ${closed ? '闭眼' : '睁眼'} [阈值=${activeThreshold}]`)
      })

      await fm.send({ image: canvasRef.current as any })
      fm.close()
    } catch (err) {
      setError(String(err))
    }
  }

  // ===== 4. 录制视频 =====
  const startRecording = useCallback(() => {
    if (!streamRef.current) { setError('请先启动相机'); return }
    chunksRef.current = []

    const recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm;codecs=vp9' })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      setRecordedBlob(blob)
      setRecordedUrl(url)
      setIsRecording(false)
      setRecordTime(0)
      if (timerRef.current) clearInterval(timerRef.current)
      setStatus(`录制完成! (${Math.round(blob.size / 1024)}KB)`)
      addLog(`录制完成 ${Math.round(blob.size / 1024)}KB`)
    }

    recorder.start(100)
    setIsRecording(true)
    setStatus(`🔴 录像中... 请眨眼! (${RECORD_DURATION_SEC}s)`)
    addLog(`开始录制 ${RECORD_DURATION_SEC}s`)

    let elapsed = 0
    timerRef.current = setInterval(() => {
      elapsed++
      setRecordTime(elapsed)
      if (elapsed >= RECORD_DURATION_SEC) recorder.stop()
    }, 1000)
  }, [])

  // ===== 5. 预分析所有帧 =====
  const analyzeRecording = useCallback(async () => {
    if (!recordedUrl || !playbackVideoRef.current) return

    setIsAnalyzing(true)
    setFrameResults([]); setTotalBlinks(0); setAnalysisDone(false)
    setStatus('预分析视频中... (逐帧提取)')
    addLog('开始预分析')

    const pv = playbackVideoRef.current

    try {
      const loaded = await waitForMediaPipe()
      if (!loaded) throw new Error('MediaPipe 未加载')

      const fm = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      })
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 })

      const results: FrameResult[] = []
      let resolveFrame: ((r: FrameResult | null) => void) | null = null
      let earHist: number[] = []           // 平滑窗口（2帧）
      let baselineHistory: number[] = []   // 自适应基线窗口（50帧）
      let eyeClosed = false
      let blinkCount = 0
      let lastBlinkT = 0

      // 算法参数（与 useBlinkDetector.ts 保持一致）
      const SMOOTH_WINDOW = 2
      const BASELINE_WINDOW = 50
      const BASELINE_DROP_RATIO = 0.12
      const useAdaptive = !calibration?.threshold && !(calibration?.openEAR && calibration?.closedEAR)

      fm.onResults((fmRes: any) => {
        if (!resolveFrame) return
        if (!fmRes.multiFaceLandmarks?.length) { resolveFrame(null); resolveFrame = null; return }

        const lm = fmRes.multiFaceLandmarks[0]
        const raw = (calcEAR(lm, LEFT_EYE_INDICES) + calcEAR(lm, RIGHT_EYE_INDICES)) / 2

        // 轻度平滑（2帧）
        earHist.push(raw)
        if (earHist.length > SMOOTH_WINDOW) earHist.shift()
        const smooth = earHist.reduce((a, b) => a + b, 0) / earHist.length

        let closed: boolean
        let baselineVal: number | undefined

        if (useAdaptive) {
          // 自适应基线模式：维护滚动中位数基线
          baselineHistory.push(raw)
          if (baselineHistory.length > BASELINE_WINDOW) baselineHistory.shift()
          const sorted = [...baselineHistory].sort((a, b) => a - b)
          baselineVal = sorted[Math.floor(sorted.length * 0.6)]
          closed = smooth < baselineVal * (1 - BASELINE_DROP_RATIO)
        } else {
          // 绝对/标定模式
          closed = smooth < activeThreshold
        }

        let blink = false
        if (closed && !eyeClosed) {
          const t = performance.now()
          if (!lastBlinkT || t - lastBlinkT > BLINK_COOLDOWN_MS) { blinkCount++; blink = true; lastBlinkT = t }
          eyeClosed = true
        } else if (!closed && eyeClosed) { eyeClosed = false }

        resolveFrame({ timeSec: pv.currentTime, rawEAR: raw, smoothedEAR: smooth, isClosed: closed, isBlink: blink, baseline: baselineVal })
        resolveFrame = null
      })

      pv.src = recordedUrl
      await new Promise<void>(r => { pv.onloadedmetadata = () => r() })

      const duration = pv.duration
      const totalFrames = Math.floor(duration * ANALYSIS_FPS)

      addLog(`视频时长 ${duration.toFixed(1)}s, 处理 ${totalFrames} 帧 [模式: ${useAdaptive ? '自适应基线' : '固定阈值=' + activeThreshold.toFixed(3)}]`)

      const ac = document.createElement('canvas')
      ac.width = pv.videoWidth || 320
      ac.height = pv.videoHeight || 240
      const actx = ac.getContext('2d')!

      for (let i = 0; i < totalFrames; i++) {
        const t = i / ANALYSIS_FPS
        pv.currentTime = t
        await new Promise<void>(r => { pv.onseeked = () => r() })
        actx.drawImage(pv, 0, 0)

        const fp = new Promise<FrameResult | null>(r2 => {
          resolveFrame = r2
          setTimeout(() => { if (resolveFrame) { resolveFrame(null); resolveFrame = null } }, 2000)
        })
        await fm.send({ image: ac as any })
        const res = await fp

        if (res) {
          res.timeSec = t
          results.push(res)
        }

        if (i % 15 === 0 || i === totalFrames - 1) {
          setFrameResults([...results])
          setTotalBlinks(blinkCount)
          setStatus(`预分析 ${i + 1}/${totalFrames} 帧, 已检测 ${blinkCount} 次眨眼`)
        }
      }

      fm.close()

      setFrameResults(results)
      setTotalBlinks(blinkCount)
      setAnalysisDone(true)
      setCurrentPlayTime(0)

      const blinks = results.filter(f => f.isBlink)
      const modeStr = useAdaptive ? '自适应基线' : `阈值=${activeThreshold.toFixed(3)}`
      setStatus(`✅ 分析完成! ${results.length} 帧, ${blinkCount} 次眨眼 (${modeStr}) — 可拖动进度条回放查看`)
      addLog(`分析完成: ${results.length} 帧, ${blinkCount} 次眨眼 [${modeStr}]`)
      if (blinks.length > 0) {
        addLog('--- 眨眼时刻 ---')
        blinks.forEach((b, idx) => addLog(`  #${idx + 1}: ${b.timeSec.toFixed(2)}s EAR=${b.smoothedEAR.toFixed(3)}`))
      }

    } catch (err) {
      setError(String(err)); setStatus('分析失败: ' + String(err))
      addLog(`错误: ${err}`)
    } finally {
      setIsAnalyzing(false)
    }
  }, [recordedUrl, activeThreshold, calibration])

  // ===== 6. 视频时间更新 → 重绘曲线图上的指示器 =====
  useEffect(() => {
    if (!analysisDone || !chartCanvasRef.current || frameResults.length === 0) return

    const drawChartWithCursor = () => {
      const canvas = chartCanvasRef.current!
      const ctx = canvas.getContext('2d')!
      const W = canvas.width
      const H = canvas.height
      const padL = 40, padR = 20, padT = 25, padB = 20
      const plotW = W - padL - padR
      const plotH = H - padT - padB

      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H)

      if (frameResults.length < 2) return

      // 范围
      const ears = frameResults.map(f => f.smoothedEAR)
      const minE = Math.min(...ears) * 0.9
      const maxE = Math.min(Math.max(...ears) * 1.1, 0.7)
      const range = maxE - minE || 0.1

      // Y轴刻度
      ctx.fillStyle = '#666'; ctx.font = '10px monospace'
      ctx.fillText(maxE.toFixed(2), 2, padT + 4)
      ctx.fillText(minE.toFixed(2), 2, H - padB)

      // 判断检测模式
      const useAdaptive = !calibration?.threshold && !(calibration?.openEAR && calibration?.closedEAR)

      if (useAdaptive) {
        // 自适应模式：绘制基线（取最后有基线值的帧）
        const lastWithBaseline = frameResults.filter(f => f.baseline).pop()
        if (lastWithBaseline?.baseline) {
          const blY = padT + (1 - (lastWithBaseline.baseline - minE) / range) * plotH
          ctx.strokeStyle = '#8a2'; ctx.lineWidth = 1; ctx.beginPath()
          ctx.moveTo(padL, blY); ctx.lineTo(W - padR, blY); ctx.stroke()
          ctx.fillStyle = '#8a2'; ctx.font = '10px monospace'
          ctx.fillText(`基线=${lastWithBaseline.baseline.toFixed(3)}`, W - padR - 80, blY - 4)

          // 阈值 = 基线 * (1 - dropRatio)，用虚线表示
          const thVal = lastWithBaseline.baseline * (1 - 0.12)
          const thY = padT + (1 - (thVal - minE) / range) * plotH
          ctx.strokeStyle = '#f80'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath()
          ctx.moveTo(padL, thY); ctx.lineTo(W - padR, thY); ctx.stroke(); ctx.setLineDash([])
          ctx.fillStyle = '#f80'; ctx.font = '10px monospace'
          ctx.fillText(`检测线=基线*0.88`, W - padR - 95, thY - 4)
        }
      } else {
        // 固定阈值模式
        const thY = padT + (1 - (activeThreshold - minE) / range) * plotH
        ctx.strokeStyle = '#f80'; ctx.lineWidth = 1; ctx.beginPath()
        ctx.moveTo(padL, thY); ctx.lineTo(W - padR, thY); ctx.stroke()
        ctx.fillStyle = '#f80'; ctx.font = '10px monospace'
        ctx.fillText(`阈值=${activeThreshold.toFixed(3)}`, W - padR - 70, thY - 4)
      }

      // 绘制曲线
      ctx.strokeStyle = '#0af'; ctx.lineWidth = 1.5; ctx.beginPath()
      frameResults.forEach((f, i) => {
        const x = padL + (i / (frameResults.length - 1)) * plotW
        const y = padT + (1 - (f.smoothedEAR - minE) / range) * plotH
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // 眨眼标记
      frameResults.forEach((f, i) => {
        if (!f.isBlink) return
        const x = padL + (i / (frameResults.length - 1)) * plotW
        const y = padT + (1 - (f.smoothedEAR - minE) / range) * plotH
        ctx.fillStyle = '#f00'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill()
      })

      // 当前播放位置指示器（竖线）
      if (currentPlayTime >= 0) {
        const dur = playbackVideoRef.current?.duration || frameResults[frameResults.length - 1]?.timeSec || 1
        const ratio = Math.min(currentPlayTime / dur, 1)
        const cx = padL + ratio * plotW
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath()
        ctx.moveTo(cx, padT); ctx.lineTo(cx, H - padB); ctx.stroke(); ctx.setLineDash([])

        // 在竖线底部显示时间和当前 EAR 值
        const nearestIdx = Math.min(Math.floor(ratio * frameResults.length), frameResults.length - 1)
        const nearest = frameResults[nearestIdx]
        if (nearest) {
          const cy = padT + (1 - (nearest.smoothedEAR - minE) / range) * plotH
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill()

          // 信息标签
          const label = `${currentPlayTime.toFixed(1)}s | EAR=${nearest.smoothedEAR.toFixed(3)} | ${nearest.isClosed ? '闭眼' : '睁眼'}`
          ctx.fillStyle = 'rgba(0,0,0,0.8)'
          const tw = ctx.measureText(label).width + 8
          const lx = Math.min(cx + 6, W - tw - 4)
          const ly = Math.max(cy - 18, padT)
          ctx.fillRect(lx, ly, tw, 16)
          ctx.fillStyle = '#fff'; ctx.font = '10px monospace'
          ctx.fillText(label, lx + 4, ly + 12)
        }
      }

      // 标题
      const modeStr = useAdaptive ? '(自适应基线)' : `(阈值=${activeThreshold.toFixed(3)})`
      ctx.fillStyle = '#aaa'; ctx.font = '11px monospace'
      ctx.fillText(`EAR 时序 ${modeStr} · ${frameResults.length}帧 · ${totalBlinks}次眨眼`, padL, 14)
    }

    drawChartWithCursor()
  }, [frameResults, totalBlinks, currentPlayTime, analysisDone, activeThreshold, calibration])

  // 清理
  useEffect(() => {
    return () => { if (recordedUrl) URL.revokeObjectURL(recordedUrl) }
  }, [recordedUrl])

  // ===== 渲染关键点可视化 =====
  const drawLandmarksImg = useCallback(() => {
    if (!photoDataUrl || landmarks.length === 0) return null
    const img = new Image(); img.src = photoDataUrl
    const c = document.createElement('canvas')
    c.width = img.width || 300; c.height = img.height || 225
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0)
    landmarks.forEach(p => { ctx.fillStyle = '#888'; ctx.fillRect(p.x * c.width - 1, p.y * c.height - 1, 2, 2) })
    ;[...LEFT_EYE_INDICES, ...RIGHT_EYE_INDICES].forEach(idx => {
      if (landmarks[idx]) { const p = landmarks[idx]; ctx.fillStyle = '#0f0'; ctx.beginPath(); ctx.arc(p.x * c.width, p.y * c.height, 3, 0, Math.PI * 2); ctx.fill() }
    })
    return c.toDataURL()
  }, [photoDataUrl, landmarks])

  // ===== 标定面板渲染 =====
  const renderCalibrationPanel = () => (
    <div style={{ background: '#111', border: '1px solid #333', padding: '12px', marginTop: '12px' }}>
      <div style={S.sectionTitle}>EAR 标定</div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
        {!calibration?.openEAR && !isCalibrating && calibStep !== 'open' && (
          <button onClick={() => startCalibration('open')} disabled={!cameraReady || isRecording}
            style={{ ...S.btnAmber, opacity: cameraReady && !isRecording ? 1 : 0.4 }}>
            📐 标定睁眼
          </button>
        )}
        {(calibration?.openEAR && !calibration.closedEAR) && !isCalibrating && calibStep !== 'closed' && (
          <button onClick={() => startCalibration('closed')} disabled={!cameraReady || isRecording}
            style={{ ...S.btnAmber, opacity: cameraReady && !isRecording ? 1 : 0.4 }}>
            📐 标定闭眼
          </button>
        )}
        {calibration?.openEAR && calibration.closedEAR && (
          <span style={{ color: '#0f0', fontSize: '12px' }}>
            ✅ 已标定 | 睁眼={calibration.openEAR.toFixed(3)} 闭眼={calibration.closedEAR.toFixed(3)}
            {' '}→ 阈值=<strong>{calibration.threshold.toFixed(3)}</strong>
          </span>
        )}
        {isCalibrating && (
          <span style={{ color: '#fa0', fontWeight: 'bold', fontSize: '14px' }}>
            📐 {calibStep === 'open' ? '请保持睁眼...' : '请保持闭眼...'} {calibCountdown}s
          </span>
        )}
      </div>

      {/* 实时 EAR 波动 */}
      {isCalibrating && calibLiveEAR.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#aaa' }}>
          采样中: {calibLiveEAR.length}/{CALIBRATE_SAMPLES} |
          平均: {(calibLiveEAR.reduce((a,b)=>a+b,0)/calibLiveEAR.length).toFixed(4)} |
          最新: {calibLiveEAR[calibLiveEAR.length-1]?.toFixed(4)}
          <span style={{ marginLeft: '12px', color: '#888' }}>
            [{calibLiveEAR.slice(-5).map(e=>e.toFixed(2)).join(', ')}]
          </span>
        </div>
      )}
      {/* 标定结果详情 */}
      {calibration?.openEAR && calibration.closedEAR && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#888' }}>
          睁眼范围: [{Math.min(...calibration.openSamples).toFixed(3)} ~ {Math.max(...calibration.openSamples).toFixed(3)}]
          {' '}|{' '}
          闭眼范围: [{Math.min(...calibration.closedSamples).toFixed(3)} ~ {Math.max(...calibration.closedSamples).toFixed(3)}]
          {' '}|{' '}
          差值={(calibration.openEAR - calibration.closedEAR).toFixed(3)}
          {' '}|{' '}
          阈值=闭眼+(差值×35%)
        </div>
      )}
    </div>
  )

  // ===== 主渲染 =====
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#000', color: '#fff', padding: '16px', fontFamily: 'monospace', zIndex: 99999, overflow: 'auto' }}>

      <h2 style={{ margin: '0 0 12px', fontSize: '16px' }}>Camera Debug Tool v2</h2>

      {/* ---- 控制栏 ---- */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {!cameraReady && <button onClick={startCamera} style={S.btn}>启动相机</button>}
        {cameraReady && !isRecording && (
          <>
            <button onClick={takePhoto} style={S.btn}>拍照</button>
            {photoDataUrl && <button onClick={analyzePhoto} style={S.btnGreen}>分析照片</button>}
            <button onClick={startRecording} style={S.btnRed}>录制 ({RECORD_DURATION_SEC}s)</button>
          </>
        )}
        {isRecording && <span style={{ color: '#f00', fontWeight: 'bold' }}>🔴 录制中... {RECORD_DURATION_SEC - recordTime}s</span>}
        {recordedUrl && !isAnalyzing && <button onClick={analyzeRecording} style={S.btnBlue}>预分析 & 回放</button>}
        {isAnalyzing && <span style={{ color: '#0af' }}>⏳ 预分析中...</span>}
        <button onClick={() => window.location.reload()} style={S.btn}>刷新</button>

        {/* 当前阈值显示 */}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: calibration ? '#0f0' : '#888' }}>
          阈值: <strong style={{ color: '#fa0' }}>{activeThreshold.toFixed(3)}</strong>
          {calibration ? ' (个性化)' : ' (默认)'}
        </span>
      </div>

      {/* ---- 状态栏 ---- */}
      <div style={S.statusBox(error)}>
        <strong>状态:</strong> {status}
        {earValue !== null && (
          <span style={{ marginLeft: '16px', color: earValue < activeThreshold ? '#fa0' : '#0a0' }}>
            EAR={earValue.toFixed(3)} ({earValue < activeThreshold ? '闭眼' : '睁眼'})
          </span>
        )}
        {analysisDone && (
          <span style={{ marginLeft: '16px', color: '#0f0' }}>
            {totalBlinks} 次眨眼 / {frameResults.length} 帧
          </span>
        )}
        {error && <div style={{ marginTop: '6px', color: '#f66' }}>ERROR: {error}</div>}
      </div>

      {/* ---- 标定面板 ---- */}
      {cameraReady && renderCalibrationPanel()}

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ---- 上半区：视频 + 照片 + 关键点 ---- */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={S.sectionTitle}>实时视频</div>
          <video ref={videoRef} autoPlay playsInline muted
            style={{ width: '280px', background: '#111', display: cameraReady && !isRecording ? 'block' : 'none' }} />
          {(!cameraReady && !isRecording) && <div {...S.placeholder(280, 210)}>点击"启动相机"</div>}
          {isRecording && (
            <div style={{ width: '280px', height: '210px', background: '#200', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#f00' }}>
              <div style={{ fontSize: '40px' }}>🔴</div>
              <div style={{ marginTop: '8px' }}>请对着摄像头眨眼!</div>
              <div style={{ fontSize: '22px', marginTop: '6px' }}>{RECORD_DURATION_SEC - recordTime}</div>
            </div>
          )}
        </div>

        <div>
          <div style={S.sectionTitle}>拍摄的照片</div>
          {photoDataUrl ? <img src={photoDataUrl} alt="" style={{ width: '280px' }} /> : <div {...S.placeholder(280, 210)}>尚未拍照</div>}
        </div>

        <div>
          <div style={S.sectionTitle}>关键点 {landmarks.length > 0 && `(${landmarks.length})`}</div>
          {landmarks.length > 0 ? <img src={drawLandmarksImg() || ''} alt="" style={{ width: '280px' }} /> : <div {...S.placeholder(280, 210)}>尚未分析</div>}
        </div>
      </div>

      {/* ---- 下半区：回放 + 曲线图（同步） ---- */}
      {recordedUrl && (
        <div style={{ marginTop: '16px', borderTop: '1px solid #333', paddingTop: '12px' }}>
          <div style={S.sectionTitle}>
            录制视频回放 ({Math.round((recordedBlob?.size||0)/1024)}KB)
            {analysisDone && <span style={{ color: '#0f0' }}> — 拖动进度条查看同步曲线</span>}
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* 视频（带 ontimeupdate 同步） */}
            <div>
              <video ref={playbackVideoRef} src={recordedUrl} controls muted
                style={{ width: '420px', background: '#111' }}
                onTimeUpdate={e => setCurrentPlayTime((e.target as HTMLVideoElement).currentTime)}
                onEnded={() => {}}
              />
              {/* 当前帧信息 */}
              {analysisDone && (() => {
                const ct = currentPlayTime
                const dur = playbackVideoRef.current?.duration || 1
                const idx = Math.min(Math.floor((ct / dur) * frameResults.length), frameResults.length - 1)
                const fr = frameResults[idx]
                return fr ? (
                  <div style={{ marginTop: '6px', fontSize: '11px', padding: '6px 10px', background: '#111', border: '1px solid #333', color: fr.isBlink ? '#f00' : fr.isClosed ? '#fa0' : '#0a0' }}>
                    T={ct.toFixed(2)}s | 原始={fr.rawEAR.toFixed(3)} 平滑={fr.smoothedEAR.toFixed(3)}
                    {' '}{fr.isClosed ? '● 闭眼' : '○ 睁眼'}
                    {fr.isBlink && ' ✅ BLINK'}
                  </div>
                ) : null
              })()}
            </div>

            {/* Canvas 实时曲线图 */}
            <div>
              <div style={S.sectionTitle}>EAR 时序图 (与视频同步)</div>
              {frameResults.length >= 2 ? (
                <>
                  <canvas ref={chartCanvasRef}
                    width={500} height={220}
                    style={{ width: '500px', border: '1px solid #333', background: '#111' }}
                  />
                  <div style={{ fontSize: '10px', color: '#555', marginTop: '4px' }}>
                    ──蓝线=平滑EAR ──虚白线=当前位置 🟠=阈值 🔴=眨眼事件
                  </div>
                </>
              ) : (
                <div {...S.placeholder(500, 220)}>{isAnalyzing ? '⏳ 正在预分析...' : analysisDone ? '数据不足' : '点击"预分析 & 回放"'}</div>
              )}
            </div>
          </div>

          {/* 帧数据表（最后 30 帧） */}
          {frameResults.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={S.sectionTitle}>帧数据 (最近 30 帧)</div>
              <pre style={{ background: '#111', padding: '10px', border: '1px solid #333', fontSize: '10px', maxHeight: '260px', overflow: 'auto', lineHeight: '1.5' }}>
                {'#'.padStart(3)} {'时间(s)'.padStart(7)} {'原始EAR'.padStart(8)} {'平滑'.padStart(8)} {'状态'.padEnd(5)} 眨眼\n{'─'.repeat(52)}
                {frameResults.slice(-30).map((f, i) => {
                  const gi = frameResults.length - 30 + i
                  return `\n${String(gi).padStart(3)} ${f.timeSec.toFixed(2).padStart(7)} ${f.rawEAR.toFixed(3).padStart(8)} ${f.smoothedEAR.toFixed(3).padStart(8)} ${f.isClosed ? '闭 '.padEnd(5) : '睁 '.padEnd(5)} ${f.isBlink ? '★' : ''}`
                })}
              </pre>
            </div>
          )}

          {/* 眨眼时刻汇总 */}
          {analysisDone && (
            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#0a0a0a', border: '1px solid #333', fontSize: '11px', color: '#aaa' }}>
              <strong style={{ color: '#fff' }}>眨眼汇总:</strong>{' '}
              {frameResults.filter(f => f.isBlink).length === 0
                ? '未检测到眨眼 — 可能需要调整阈值'
                : frameResults.filter(f => f.isBlink).map((f, i) =>
                    <span key={i} style={{ marginRight: '12px', color: '#f00' }}>
                      #{i + 1} {f.timeSec.toFixed(2)}s (EAR={f.smoothedEAR.toFixed(3)})
                    </span>
                  )
              }
            </div>
          )}
        </div>
      )}

      {/* ---- 日志 ---- */}
      <div style={{ marginTop: '16px' }}>
        <div style={S.sectionTitle}>日志</div>
        <pre style={{ background: '#111', padding: '10px', border: '1px solid #333', maxHeight: '160px', overflow: 'auto', fontSize: '10px', color: '#999' }}>
          {logs.join('\n') || '(无)'}
        </pre>
      </div>

      {/* ---- 使用说明 ---- */}
      <div style={{ marginTop: '12px', padding: '10px 12px', background: '#0c0c0c', border: '1px solid #222', fontSize: '11px', color: '#777' }}>
        <strong style={{ color: '#aaa' }}>使用步骤:</strong><br/>
        1. <strong>启动相机</strong> → 允许访问<br/>
        2. <strong>标定睁眼</strong> → 保持睁眼 2.5 秒 → <strong>标定闭眼</strong> → 保持闭眼 2.5 秒 → 自动计算个性化阈值<br/>
        3. <strong>录制</strong> → 对着摄像头正常眨几次眼 (8s)<br/>
        4. <strong>预分析 & 回放</strong> → 逐帧处理完成后，拖动视频进度条，曲线图实时同步显示当前帧的 EAR 和状态<br/><br/>
        <strong>标定原理:</strong> 采集你个人的睁眼/闭眼 EAR 分布，在两者之间取 35% 位置作为阈值，
        比固定阈值 0.4 更准确适配你的面部特征。
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  )
}
