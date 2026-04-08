import styles from './AlertOverlay.module.css'

interface AlertOverlayProps {
  isActive: boolean
  level: 'normal' | 'warning' | 'danger'
  message?: string
  visualEnabled: boolean
  onDismiss?: () => void
}

// Segmented edge light component
function SegmentedEdgeLight({ 
  isActive, 
  level 
}: { 
  isActive: boolean
  level: 'normal' | 'warning' | 'danger'
}) {
  const segments = 20
  
  return (
    <div 
      className={`${styles.edgeLight} ${
        isActive ? styles.active : ''
      } ${
        level === 'danger' ? styles.danger : 
        level === 'warning' ? styles.warning : ''
      }`}
    >
      {Array.from({ length: segments }, (_, i) => (
        <div key={i} className={styles.segment} />
      ))}
    </div>
  )
}

export function AlertOverlay({
  isActive,
  level,
  message,
  visualEnabled,
  onDismiss,
}: AlertOverlayProps) {
  if (!visualEnabled) return null
  
  const showCenterAlert = isActive && level === 'danger'
  
  return (
    <div className={styles.overlay}>
      {/* Segmented edge light */}
      <SegmentedEdgeLight isActive={isActive} level={level} />
      
      {/* Center alert (danger level only) */}
      {showCenterAlert && (
        <div className={`${styles.centerAlert} ${styles.active}`}>
          <div className={styles.alertCode}>[ALERT: CRITICAL]</div>
          <div className={styles.alertTitle}>BLINK NOW</div>
          <div className={styles.alertMessage}>
            {message || 'Blink rate critically low. Protect your eyes.'}
          </div>
          <button className={styles.dismissBtn} onClick={onDismiss}>
            Acknowledge
          </button>
        </div>
      )}
    </div>
  )
}
