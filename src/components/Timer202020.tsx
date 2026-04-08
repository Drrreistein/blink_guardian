import { useState, useEffect, useCallback, useRef } from 'react'
import styles from './Timer202020.module.css'

interface Timer202020Props {
  enabled: boolean
}

type TimerState = 'running' | 'resting' | 'paused'

const WORK_DURATION = 20 * 60 // 20 minutes
const REST_DURATION = 20 // 20 seconds

export function Timer202020({ enabled }: Timer202020Props) {
  const [isMinimized, setIsMinimized] = useState(false)
  const [state, setState] = useState<TimerState>('running')
  const [timeLeft, setTimeLeft] = useState(WORK_DURATION)
  const [showRestOverlay, setShowRestOverlay] = useState(false)
  
  const intervalRef = useRef<number | null>(null)
  
  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])
  
  const startWork = useCallback(() => {
    setState('running')
    setTimeLeft(WORK_DURATION)
    setShowRestOverlay(false)
  }, [])
  
  const startRest = useCallback(() => {
    setState('resting')
    setTimeLeft(REST_DURATION)
    setShowRestOverlay(true)
    
    // 发送通知
    if (Notification.permission === 'granted') {
      new Notification('该休息了！', {
        body: '看20英尺外20秒，让眼睛放松一下',
        icon: '/favicon.ico',
      })
    }
  }, [])
  
  const pause = useCallback(() => {
    setState('paused')
    clearTimer()
  }, [clearTimer])
  
  const resume = useCallback(() => {
    setState(timeLeft > 0 && timeLeft <= REST_DURATION ? 'resting' : 'running')
  }, [timeLeft])
  
  const skipRest = useCallback(() => {
    startWork()
  }, [startWork])
  
  // 计时器逻辑
  useEffect(() => {
    if (!enabled || state === 'paused') {
      clearTimer()
      return
    }
    
    intervalRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // 时间到
          if (state === 'running') {
            startRest()
            return REST_DURATION
          } else {
            startWork()
            return WORK_DURATION
          }
        }
        return prev - 1
      })
    }, 1000)
    
    return clearTimer
  }, [enabled, state, startRest, startWork, clearTimer])
  
  if (!enabled) return null
  
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  
  const isWarning = state === 'running' && timeLeft <= 60
  const isRest = state === 'resting'
  const totalTime = isRest ? REST_DURATION : WORK_DURATION
  const progress = ((totalTime - timeLeft) / totalTime) * 100
  
  if (isMinimized) {
    return (
      <>
        <div 
          className={`${styles.timer} ${styles.minimized}`}
          onClick={() => setIsMinimized(false)}
          title="点击展开"
        >
          <div className={styles.minimizedContent}>
            <span className={styles.minimizedIcon}>⏱️</span>
            <span className={`${styles.minimizedTime} ${isWarning ? styles.warning : ''}`}>
              {formatTime(timeLeft)}
            </span>
          </div>
        </div>
        
        {/* 休息覆盖层 */}
        <div className={`${styles.restOverlay} ${showRestOverlay ? styles.active : ''}`}>
          <div className={styles.restIcon}>🌿</div>
          <div className={styles.restTitle}>20-20-20 休息</div>
          <div className={styles.restSubtitle}>看20英尺（6米）外的物体</div>
          <div className={styles.restCountdown}>{timeLeft}</div>
          <div className={styles.restHint}>保护眼睛，缓解疲劳</div>
          <button className={styles.skipBtn} onClick={skipRest}>
            跳过休息
          </button>
        </div>
      </>
    )
  }
  
  return (
    <>
      <div className={styles.timer}>
        <div className={styles.header}>
          <span className={styles.title}>
            <span className={styles.icon}>⏱️</span>
            20-20-20 护眼
          </span>
          <div className={styles.controls}>
            <button 
              className={styles.iconBtn} 
              onClick={() => setIsMinimized(true)}
              title="最小化"
            >
              −
            </button>
          </div>
        </div>
        
        <div className={styles.countdown}>
          <div className={`${styles.time} ${isWarning ? styles.warning : ''} ${isRest ? styles.rest : ''}`}>
            {formatTime(timeLeft)}
          </div>
          <div className={styles.label}>
            {isRest ? '休息时间' : isWarning ? '即将休息' : '工作计时'}
          </div>
        </div>
        
        <div className={styles.progress}>
          <div 
            className={`${styles.progressBar} ${isWarning ? styles.warning : ''} ${isRest ? styles.rest : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        
        <div className={styles.actions}>
          {state === 'paused' ? (
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={resume}>
              继续
            </button>
          ) : (
            <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={pause}>
              暂停
            </button>
          )}
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={startWork}>
            重置
          </button>
        </div>
      </div>
      
      {/* 休息覆盖层 */}
      <div className={`${styles.restOverlay} ${showRestOverlay ? styles.active : ''}`}>
        <div className={styles.restIcon}>🌿</div>
        <div className={styles.restTitle}>20-20-20 休息</div>
        <div className={styles.restSubtitle}>看20英尺（6米）外的物体</div>
        <div className={styles.restCountdown}>{timeLeft}</div>
        <div className={styles.restHint}>保护眼睛，缓解疲劳</div>
        <button className={styles.skipBtn} onClick={skipRest}>
          跳过休息
        </button>
      </div>
    </>
  )
}
