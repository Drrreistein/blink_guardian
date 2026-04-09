import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useBlinkDetector } from '../hooks/useBlinkDetector'
import type { BlinkData } from '../hooks/useBlinkDetector'
import { useSessionStorage } from '../hooks/useSessionStorage'
import { useAlert } from '../hooks/useAlert'
import { useGlobalMode } from '../hooks/useGlobalMode'
import styles from './MonitorWidget.module.css'

interface MonitorWidgetProps {
  onOpenSettings?: () => void
  onOpenAnalytics?: () => void
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function getStatusText(level: 'normal' | 'warning' | 'danger', blinkRate: number): string {
  if (level === 'danger') return 'CRITICAL'
  if (level === 'warning') return 'WARNING'
  if (blinkRate >= 15) return 'NORMAL'
  return 'MONITORING'
}

// Segmented Progress Bar Component
function SegmentedBar({ rate, threshold }: { rate: number; threshold: number }) {
  const segments = 12
  const activeCount = useMemo(() => {
    if (rate <= 0) return 0
    const ratio = Math.min(rate / (threshold * 1.5), 1)
    return Math.max(1, Math.round(ratio * segments))
  }, [rate, threshold])
  
  const getSegmentClass = (index: number) => {
    if (index >= activeCount) return ''
    const ratio = index / segments
    if (ratio > 0.7) return styles.danger
    if (ratio > 0.4) return styles.warning
    return styles.active
  }
  
  return (
    <div className={styles.segmentedBar}>
      {Array.from({ length: segments }, (_, i) => (
        <div key={i} className={`${styles.segment} ${getSegmentClass(i)}`} />
      ))}
    </div>
  )
}

export function MonitorWidget({ onOpenSettings, onOpenAnalytics }: MonitorWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [sessionStartTime] = useState(Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)

  const { currentSession, startSession, updateSession, endSession } = useSessionStorage()
  const { config: alertConfig, alertLevel, checkBlinkRate } = useAlert()

  const handleBlink = useCallback(() => {
    if (currentSession) {
      updateSession({
        totalBlinks: currentSession.totalBlinks + 1,
      })
    }
  }, [currentSession, updateSession])

  const handleBlinkRateChange = useCallback((rate: number) => {
    checkBlinkRate(rate)
    if (currentSession) {
      updateSession({
        avgBlinkRate: rate,
      })
    }
  }, [checkBlinkRate, currentSession, updateSession])
  
  // 从 localStorage 读取标定数据（Debug 页面写入）
  const [calibration, setCalibration] = useState<{ openEAR: number; closedEAR: number } | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('blinkguardian_calibration')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.openEAR && parsed.closedEAR) {
          setCalibration(parsed)
        }
      }
    } catch { /* ignore */ }
  }, [])

  const { videoRef, isInitialized, error, blinkData } = useBlinkDetector({
    onBlink: handleBlink,
    onBlinkRateChange: handleBlinkRateChange,
    calibration: calibration || undefined,
  })

  // 全局监测模式（Picture-in-Picture）
  const blinkDataRef = useRef(blinkData)
  blinkDataRef.current = blinkData

  const { isGlobalActive: isGlobalMode, toggleGlobalMode } = useGlobalMode({
    getBlinkData: () => blinkDataRef.current,
    calibration: calibration || undefined,
    onBlink: handleBlink,
    onBlinkRateChange: handleBlinkRateChange,
  })

  // 全局模式时，UI 显示 PiP 回传的数据（而非本地检测器的数据）
  const [pipBlinkData, setPipBlinkData] = useState<BlinkData | null>(null)

  // 最终展示给用户的数据：全局模式优先用 PiP 数据，否则用本地数据
  const displayData = isGlobalMode && pipBlinkData ? pipBlinkData : blinkData

  // 监听 PiP 窗口回传的眨眼数据，同步到主页面 UI
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'BLINK_GUARDIAN_UPDATE' && isGlobalMode) {
        const pipData = event.data.data as BlinkData
        // 更新 UI 展示数据
        setPipBlinkData(pipData)
        // 同步到 alert 检测和 session 统计
        checkBlinkRate(pipData.blinkRate)
        if (currentSession) {
          updateSession({ avgBlinkRate: pipData.blinkRate })
          // 同步累计眨眼数（以 PiP 的为准，因为它是活跃检测源）
          if (pipData.blinkCount > 0) {
            updateSession({ totalBlinks: pipData.blinkCount })
          }
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isGlobalMode, currentSession, checkBlinkRate, updateSession])

  // 退出全局模式时清除 PiP 数据，切回本地检测器
  useEffect(() => {
    if (!isGlobalMode) {
      setPipBlinkData(null)
    }
  }, [isGlobalMode])

  // 组件卸载时关闭全局模式
  useEffect(() => {
    return () => {
      // useGlobalMode 内部会处理清理，但确保页面关闭时也清理
      try {
        const pipWindow = (window as any).documentPictureInPicture?.window
        if (pipWindow && !pipWindow.closed) {
          pipWindow.close()
        }
      } catch { /* ignore */ }
    }
  }, [])
  
  // Start session
  useEffect(() => {
    if (isInitialized && !currentSession) {
      startSession()
    }
  }, [isInitialized, currentSession, startSession])
  
  // Update timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Date.now() - sessionStartTime)
    }, 1000)
    return () => clearInterval(interval)
  }, [sessionStartTime])
  
  // End session on unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      endSession()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      endSession()
    }
  }, [endSession])
  
  // Minimized state
  if (!isExpanded) {
    const displayRate = displayData.blinkRate
    const rateClass = displayRate < alertConfig.lowBlinkThreshold * 0.5 
      ? styles.danger 
      : displayRate < alertConfig.lowBlinkThreshold 
        ? styles.warning 
        : styles.normal
    
    return (
      <div 
        className={`${styles.widget} ${styles.minimized}`}
        onClick={() => setIsExpanded(true)}
        title="Click to expand"
      >
        <span className={`${styles.minimizedRate} ${rateClass}`}>
          {displayRate}
        </span>
      </div>
    )
  }
  
  // Error state - still show controls
  if (error) {
    return (
      <div className={`${styles.widget} ${styles.expanded}`}>
        <div className={styles.header}>
          <span className={styles.title}>BLINK GUARDIAN</span>
          <div className={styles.controls}>
            <button 
              className={styles.iconBtn} 
              onClick={onOpenAnalytics}
              title="Analytics"
            >
              ≡
            </button>
            <button 
              className={styles.iconBtn} 
              onClick={onOpenSettings}
              title="Settings"
            >
              ⚙
            </button>
            <button className={styles.iconBtn} onClick={() => setIsExpanded(false)}>
              −
            </button>
          </div>
        </div>
        <div className={`${styles.statusIndicator} ${styles.statusDanger}`}>
          <span className={styles.dot} />
          CAMERA ERROR
        </div>
        <div className={styles.errorText}>
          {error}. Please check camera permissions and reload.
        </div>
        {/* Hidden video element */}
        <video 
          ref={videoRef}
          className={styles.videoHidden}
          playsInline
          muted
        />
      </div>
    )
  }
  
  // Initializing state - still show controls and hidden video for camera init
  if (!isInitialized) {
    return (
      <div className={`${styles.widget} ${styles.expanded}`}>
        <div className={styles.header}>
          <span className={styles.title}>BLINK GUARDIAN</span>
          <div className={styles.controls}>
            <button 
              className={styles.iconBtn} 
              onClick={onOpenAnalytics}
              title="Analytics"
            >
              ≡
            </button>
            <button 
              className={styles.iconBtn} 
              onClick={onOpenSettings}
              title="Settings"
            >
              ⚙
            </button>
            <button className={styles.iconBtn} onClick={() => setIsExpanded(false)}>
              −
            </button>
          </div>
        </div>
        <div className={styles.statusIndicator}>
          <span className={styles.dot} />
          INITIALIZING...
        </div>
        <div className={styles.helpText}>
          Please allow camera access to enable blink detection
        </div>
        {/* Hidden video element for camera initialization */}
        <video 
          ref={videoRef}
          className={styles.videoHidden}
          playsInline
          muted
        />
      </div>
    )
  }
  
  const statusClass = alertLevel === 'danger' 
    ? styles.statusDanger 
    : alertLevel === 'warning' 
      ? styles.statusWarning 
      : styles.statusNormal
  
  const rateClass = displayData.blinkRate < alertConfig.lowBlinkThreshold * 0.5
    ? styles.danger
    : displayData.blinkRate < alertConfig.lowBlinkThreshold 
      ? styles.warning 
      : styles.normal
  
  return (
    <div className={`${styles.widget} ${styles.expanded}`}>
      <div className={styles.header}>
        <span className={styles.title}>BLINK GUARDIAN</span>
        <div className={styles.controls}>
          <button 
            className={styles.iconBtn} 
            onClick={toggleGlobalMode}
            title={isGlobalMode ? 'Exit global mode' : 'Global mode (always on top)'}
            style={{ color: isGlobalMode ? '#0f0' : '#888' }}
          >
            ⬚
          </button>
          <button 
            className={styles.iconBtn} 
            onClick={onOpenAnalytics}
            title="Analytics"
          >
            ≡
          </button>
          <button 
            className={styles.iconBtn} 
            onClick={onOpenSettings}
            title="Settings"
          >
            ⚙
          </button>
          <button 
            className={styles.iconBtn} 
            onClick={() => setIsExpanded(false)}
            title="Minimize"
          >
            −
          </button>
        </div>
      </div>
      
      <div className={styles.mainStat}>
        <span className={`${styles.rateValue} ${rateClass}`}>
          {displayData.blinkRate}
        </span>
        <span className={styles.rateUnit}>BPM</span>
        <div className={styles.rateLabel}>BLINK RATE</div>
        <SegmentedBar rate={displayData.blinkRate} threshold={alertConfig.lowBlinkThreshold} />
      </div>
      
      <div className={`${styles.statusIndicator} ${statusClass}`}>
        <span className={styles.dot} />
        {getStatusText(alertLevel, displayData.blinkRate)}
        {isGlobalMode && (
          <span style={{ color: '#0f0', fontSize: '9px', marginLeft: 8, letterSpacing: '0.05em' }}>GLOBAL</span>
        )}
      </div>
      
      <div className={styles.stats}>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{displayData.blinkCount}</div>
          <div className={styles.statLabel}>TOTAL</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{formatDuration(elapsedTime)}</div>
          <div className={styles.statLabel}>ELAPSED</div>
        </div>
      </div>
      
      {/* Real-time Blink Detection Indicator */}
      <div className={styles.blinkIndicator}>
        <div className={`${styles.eyeIcon} ${displayData.isBlinking ? styles.eyeClosed : styles.eyeOpen}`}>
          {displayData.isBlinking ? '◉' : '○'}
        </div>
        <div className={styles.blinkStatus}>
          {displayData.isBlinking ? 'BLINK DETECTED' : 'EYES OPEN'}
        </div>
        <div className={styles.earValue}>
          EAR: {(displayData.rawEar || displayData.eyeOpenness).toFixed(2)}{' '}
          {calibration?.openEAR
            ? `[阈值=${((calibration.closedEAR + (calibration.openEAR - calibration.closedEAR) * 0.35)).toFixed(2)}]`
            : '[自适应]'
          }
          {displayData.baseline && <span style={{ color: '#6a4' }}> 基线={displayData.baseline.toFixed(2)}</span>}
        </div>
      </div>

      {/* Hidden video element for camera initialization */}
      <video 
        ref={videoRef}
        className={styles.videoHidden}
        playsInline
        muted
        autoPlay
      />
    </div>
  )
}
