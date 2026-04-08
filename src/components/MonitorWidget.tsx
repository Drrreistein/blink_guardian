import { useState, useEffect, useCallback, useMemo } from 'react'
import { useBlinkDetector } from '../hooks/useBlinkDetector'
import { useSessionStorage } from '../hooks/useSessionStorage'
import { useAlert } from '../hooks/useAlert'
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
  const [showVideo, setShowVideo] = useState(false)
  const [sessionStartTime] = useState(Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)
  
  const { currentSession, startSession, updateSession, endSession } = useSessionStorage()
  const { config, alertLevel, checkBlinkRate } = useAlert()
  
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
  
  const { videoRef, isInitialized, error, blinkData } = useBlinkDetector({
    onBlink: handleBlink,
    onBlinkRateChange: handleBlinkRateChange,
  })
  
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
    const displayRate = blinkData.blinkRate
    const rateClass = displayRate < config.lowBlinkThreshold * 0.5 
      ? styles.danger 
      : displayRate < config.lowBlinkThreshold 
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
  
  const rateClass = blinkData.blinkRate < config.lowBlinkThreshold * 0.5 
    ? styles.danger 
    : blinkData.blinkRate < config.lowBlinkThreshold 
      ? styles.warning 
      : styles.normal
  
  return (
    <div className={`${styles.widget} ${styles.expanded}`}>
      <div className={styles.header}>
        <span className={styles.title}>BLINK GUARDIAN</span>
        <div className={styles.controls}>
          <button 
            className={styles.iconBtn} 
            onClick={() => setShowVideo(!showVideo)}
            title={showVideo ? 'Hide preview' : 'Show preview'}
          >
            {showVideo ? '◉' : '○'}
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
          {blinkData.blinkRate}
        </span>
        <span className={styles.rateUnit}>BPM</span>
        <div className={styles.rateLabel}>BLINK RATE</div>
        <SegmentedBar rate={blinkData.blinkRate} threshold={config.lowBlinkThreshold} />
      </div>
      
      <div className={`${styles.statusIndicator} ${statusClass}`}>
        <span className={styles.dot} />
        {getStatusText(alertLevel, blinkData.blinkRate)}
      </div>
      
      <div className={styles.stats}>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{blinkData.blinkCount}</div>
          <div className={styles.statLabel}>TOTAL</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{formatDuration(elapsedTime)}</div>
          <div className={styles.statLabel}>ELAPSED</div>
        </div>
      </div>
      
      <video 
        ref={videoRef}
        className={`${styles.videoPreview} ${showVideo ? '' : styles.videoHidden}`}
        playsInline
        muted
      />
    </div>
  )
}
