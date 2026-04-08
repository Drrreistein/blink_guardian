/**
 * Camera Debug Tool - 用于测试摄像头和 MediaPipe 算法
 * 
 * 功能：
 * 1. 显示摄像头画面
 * 2. 手动拍摄照片
 * 3. 使用 MediaPipe FaceMesh 分析照片
 * 4. 显示检测到的人脸关键点和 EAR 值
 */
import { useState, useRef, useCallback } from 'react'

export function CameraDebug() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceMeshRef = useRef<any>(null)
  
  const [status, setStatus] = useState<string>('等待启动...')
  const [cameraReady, setCameraReady] = useState(false)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [landmarks, setLandmarks] = useState<{x: number; y: number}[]>([])
  const [earValue, setEarValue] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (msg: string) => {
    console.log('[Debug]', msg)
    setLogs(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()} - ${msg}`])
  }

  // 启动摄像头
  const startCamera = async () => {
    try {
      setStatus('正在请求相机权限...')
      setError(null)
      addLog('请求相机权限')
      
      if (!videoRef.current) throw new Error('Video element not found')
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      })
      
      addLog('相机权限已获取')
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      
      setCameraReady(true)
      setStatus('相机就绪 - 点击"拍照"按钮拍摄')
      addLog('相机已启动')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStatus('错误: ' + msg)
      addLog(`错误: ${msg}`)
    }
  }

  // 拍照
  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) {
      setError('Video 或 Canvas 元素未找到')
      addLog('错误: Video/Canvas 未找到')
      return
    }
    
    const video = videoRef.current
    addLog(`视频尺寸: ${video.videoWidth}x${video.videoHeight}, readyState: ${video.readyState}`)
    
    if (video.videoWidth === 0) {
      setError('视频尚未加载完成，请稍后重试')
      addLog('错误: 视频宽度为0')
      return
    }
    
    const canvas = canvasRef.current
    
    // 使用实际视频尺寸
    const width = Math.max(1, video.videoWidth)
    const height = Math.max(1, video.videoHeight)
    
    canvas.width = width
    canvas.height = height
    
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('无法获取 Canvas 上下文')
      addLog('错误: 无法获取 Canvas context')
      return
    }
    
    // 绘制视频帧到 canvas
    ctx.drawImage(video, 0, 0, width, height)
    
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
      setPhotoDataUrl(dataUrl)
      setStatus(`已拍照 - 点击"分析"按钮检测人脸 (${width}x${height})`)
      addLog(`拍照完成: ${width}x${height}`)
    } catch (e) {
      setError(`生成图片失败: ${String(e)}`)
      addLog(`错误: toDataURL 失败 - ${String(e)}`)
    }
  }, [])

  // 使用 MediaPipe 分析
  const analyzeFace = async () => {
    if (!canvasRef.current) {
      setError('没有可分析的照片')
      return
    }

    try {
      setStatus('正在加载 MediaPipe...')
      addLog('开始加载 MediaPipe 库')

      // 等待 MediaPipe 加载
      let attempts = 0
      while ((!window.FaceMesh) && attempts < 50) {
        await new Promise(r => setTimeout(r, 100))
        attempts++
      }

      if (!window.FaceMesh) {
        throw new Error('MediaPipe FaceMesh 未加载')
      }
      addLog('MediaPipe 已加载')

      // 创建 FaceMesh 实例
      const faceMesh = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      })

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      faceMeshRef.current = faceMesh

      // 设置结果回调
      faceMesh.onResults((results: any) => {
        addLog('收到检测结果')
        
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const lm = results.multiFaceLandmarks[0]
          setLandmarks(lm)
          
          // 计算 EAR
          const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
          const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380]
          
          const calcEAR = (indices: number[]) => {
            const p = indices.map(i => lm[i])
            const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y)
            const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y)
            const h = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y)
            return (v1 + v2) / (2 * h)
          }
          
          const leftEAR = calcEAR(LEFT_EYE_INDICES)
          const rightEAR = calcEAR(RIGHT_EYE_INDICES)
          const avgEAR = (leftEAR + rightEAR) / 2
          
          setEarValue(avgEAR)
          
          const isClosed = avgEAR < 0.22
          setStatus(isClosed ? `检测到闭眼! EAR=${avgEAR.toFixed(3)}` : `眼睛睁开. EAR=${avgEAR.toFixed(3)}`)
          addLog(`左眼 EAR: ${leftEAR.toFixed(3)}, 右眼 EAR: ${rightEAR.toFixed(3)}, 平均: ${avgEAR.toFixed(3)}, ${isClosed ? '闭眼' : '睁眼'}`)
        } else {
          setStatus('未检测到人脸')
          addLog('未检测到人脸')
          setLandmarks([])
          setEarValue(null)
        }
      })

      // 发送图像进行分析
      setStatus('正在分析...')
      addLog('发送图像给 FaceMesh')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await faceMesh.send({ image: canvasRef.current as any })
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStatus('分析失败: ' + msg)
      addLog(`分析错误: ${msg}`)
    }
  }

  // 绘制关键点
  const drawLandmarks = () => {
    if (!photoDataUrl || landmarks.length === 0) return null
    
    const img = new window.Image()
    img.src = photoDataUrl
    
    const canvas = document.createElement('canvas')
    canvas.width = img.width || 300
    canvas.height = img.height || 225
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    
    ctx.drawImage(img, 0, 0)
    
    // 绘制所有关键点（灰色）
    landmarks.forEach((p) => {
      ctx.fillStyle = '#888'
      ctx.fillRect(p.x * canvas.width - 1, p.y * canvas.height - 1, 2, 2)
    })
    
    // 高亮眼部关键点（绿色）
    const eyeIndices = [
      ...[33, 160, 158, 133, 153, 144],   // 左眼
      ...[362, 385, 387, 263, 373, 380]    // 右眼
    ]
    eyeIndices.forEach((idx) => {
      if (landmarks[idx]) {
        const p = landmarks[idx]
        ctx.fillStyle = '#00ff00'
        ctx.beginPath()
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    })
    
    return canvas.toDataURL()
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: '#000',
      color: '#fff',
      padding: '20px',
      fontFamily: 'monospace',
      zIndex: 99999,
      overflow: 'auto'
    }}>
      <h2 style={{ margin: '0 0 16px', color: '#fff' }}>
        📷 Camera Debug Tool - 相机调试工具
      </h2>
      
      {/* 控制面板 */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {!cameraReady && (
          <button onClick={startCamera} style={buttonStyle}>
            📹 启动相机
          </button>
        )}
        {cameraReady && (
          <button onClick={takePhoto} style={buttonStyle}>
            📸 拍照
          </button>
        )}
        {photoDataUrl && (
          <button onClick={analyzeFace} style={{...buttonStyle, background: '#00aa44'}}>
            🔍 分析人脸
          </button>
        )}
        <button onClick={() => window.location.reload()} style={buttonStyle}>
          🔄 刷新
        </button>
      </div>

      {/* 状态 */}
      <div style={{
        padding: '12px',
        background: error ? '#330000' : '#111',
        border: `1px solid ${error ? '#f00' : '#333'}`,
        marginBottom: '16px',
        color: error ? '#f66' : '#ccc'
      }}>
        <strong>状态:</strong> {status}
        {earValue !== null && (
          <span style={{ marginLeft: '24px', color: earValue < 0.22 ? '#fa0' : '#0a0' }}>
            EAR 值: {earValue.toFixed(3)} ({earValue < 0.22 ? '闭眼' : '睁眼'})
          </span>
        )}
        {error && <div style={{ marginTop: '8px', color: '#f66' }}>❌ {error}</div>}
      </div>

      {/* 隐藏的 Canvas 用于拍照 */}
      <canvas 
        ref={canvasRef} 
        style={{ display: 'none' }}
        width={320} 
        height={240}
      />
      
      {/* 视频和照片 */}
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        {/* 视频预览 */}
        <div>
          <h3 style={{ margin: '0 0 8px', color: '#888', fontSize: '12px' }}>实时视频</h3>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '320px', background: '#111', display: cameraReady ? 'block' : 'none' }}
          />
          {!cameraReady && (
            <div style={{
              width: '320px', height: '240px',
              background: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#555'
            }}>
              点击"启动相机"
            </div>
          )}
        </div>

        {/* 拍摄的照片 */}
        <div>
          <h3 style={{ margin: '0 0 8px', color: '#888', fontSize: '12px' }}>拍摄的照片</h3>
          {photoDataUrl ? (
            <img src={photoDataUrl} alt="Captured" style={{ width: '320px' }} />
          ) : (
            <div style={{
              width: '320px', height: '240px',
              background: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#555'
            }}>
              尚未拍照
            </div>
          )}
        </div>

        {/* 关键点可视化 */}
        <div>
          <h3 style={{ margin: '0 0 8px', color: '#888', fontSize: '12px' }}>
            关键点可视化 {landmarks.length > 0 && `(共 ${landmarks.length} 个)`}
          </h3>
          {landmarks.length > 0 ? (
            <img src={drawLandmarks() || ''} alt="Landmarks" style={{ width: '320px' }} />
          ) : (
            <div style={{
              width: '320px', height: '240px',
              background: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#555'
            }}>
              尚未分析
            </div>
          )}
        </div>
      </div>

      {/* 日志 */}
      <div style={{ marginTop: '20px' }}>
        <h3 style={{ margin: '0 0 8px', color: '#888', fontSize: '12px' }}>日志</h3>
        <pre style={{
          background: '#111',
          padding: '12px',
          border: '1px solid #333',
          maxHeight: '150px',
          overflow: 'auto',
          fontSize: '11px',
          color: '#aaa'
        }}>
          {logs.join('\n') || '(无日志)'}
        </pre>
      </div>

      {/* 使用说明 */}
      <div style={{ marginTop: '20px', padding: '12px', background: '#111', border: '1px solid #333', fontSize: '11px', color: '#888' }}>
        <strong>使用步骤:</strong><br/>
        1. 点击 "启动相机" → 允许浏览器访问摄像头<br/>
        2. 对着摄像头，点击 "拍照"<br/>
        3. 保持姿势不变，点击 "分析人脸"<br/>
        4. 查看 EAR 值和关键点可视化<br/><br/>
        <strong>EAR 阈值说明:</strong> EAR &lt; 0.22 判定为闭眼，≥ 0.22 为睁眼<br/>
        正常睁眼 EAR 约 0.25-0.35，闭眼时约 0.10-0.18
      </div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#222',
  color: '#fff',
  border: '1px solid #555',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '13px'
}
