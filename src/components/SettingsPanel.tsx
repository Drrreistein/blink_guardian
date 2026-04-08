import { useState, useCallback } from 'react'
import type { AlertConfig } from '../hooks/useAlert'
import type { SessionRecord } from '../hooks/useSessionStorage'
import styles from './SettingsPanel.module.css'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  alertConfig: AlertConfig
  onSaveAlertConfig: (config: Partial<AlertConfig>) => void
  sessions: SessionRecord[]
  onExportData: () => string
  onClearAll: () => void
  timerEnabled: boolean
  onToggleTimer: () => void
}

export function SettingsPanel({
  isOpen,
  onClose,
  alertConfig,
  onSaveAlertConfig,
  sessions,
  onExportData,
  onClearAll,
  timerEnabled,
  onToggleTimer,
}: SettingsPanelProps) {
  const [localConfig, setLocalConfig] = useState(alertConfig)
  
  const handleToggle = useCallback((key: keyof AlertConfig) => {
    const newConfig = { ...localConfig, [key]: !localConfig[key] }
    setLocalConfig(newConfig)
    onSaveAlertConfig({ [key]: !localConfig[key] })
  }, [localConfig, onSaveAlertConfig])
  
  const handleNumberChange = useCallback((key: 'lowBlinkThreshold' | 'reminderInterval', value: number) => {
    const newConfig = { ...localConfig, [key]: value }
    setLocalConfig(newConfig)
    onSaveAlertConfig({ [key]: value })
  }, [localConfig, onSaveAlertConfig])
  
  const handleExport = useCallback(() => {
    const data = onExportData()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `blink-guardian-export-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [onExportData])
  
  const handleClear = useCallback(() => {
    if (confirm('确定要清空所有数据吗？此操作不可恢复。')) {
      onClearAll()
    }
  }, [onClearAll])
  
  const totalSessions = sessions.length
  const totalBlinks = sessions.reduce((sum, s) => sum + s.totalBlinks, 0)
  
  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.open : ''}`} onClick={onClose} />
      <div className={`${styles.panel} ${isOpen ? styles.open : ''}`}>
        <div className={styles.header}>
          <span className={styles.title}>设置</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        
        <div className={styles.content}>
          {/* 功能开关 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>功能开关</div>
            <div className={styles.card}>
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>20-20-20 定时器</div>
                  <div className={styles.description}>每20分钟提醒休息20秒</div>
                </div>
                <button 
                  className={`${styles.toggle} ${timerEnabled ? styles.active : ''}`}
                  onClick={onToggleTimer}
                >
                  <span className={styles.toggleThumb} />
                </button>
              </div>
            </div>
          </div>

          {/* 提醒设置 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>眨眼提醒</div>
            <div className={styles.card}>
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>启用提醒</div>
                  <div className={styles.description}>眨眼频率过低时自动提醒</div>
                </div>
                <button 
                  className={`${styles.toggle} ${localConfig.enabled ? styles.active : ''}`}
                  onClick={() => handleToggle('enabled')}
                >
                  <span className={styles.toggleThumb} />
                </button>
              </div>
              
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>视觉提醒</div>
                  <div className={styles.description}>屏幕边缘显示呼吸灯效果</div>
                </div>
                <button 
                  className={`${styles.toggle} ${localConfig.visualEnabled ? styles.active : ''}`}
                  onClick={() => handleToggle('visualEnabled')}
                  disabled={!localConfig.enabled}
                >
                  <span className={styles.toggleThumb} />
                </button>
              </div>
              
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>声音提醒</div>
                  <div className={styles.description}>播放提示音</div>
                </div>
                <button 
                  className={`${styles.toggle} ${localConfig.soundEnabled ? styles.active : ''}`}
                  onClick={() => handleToggle('soundEnabled')}
                  disabled={!localConfig.enabled}
                >
                  <span className={styles.toggleThumb} />
                </button>
              </div>
              
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>浏览器通知</div>
                  <div className={styles.description}>系统级弹窗提醒</div>
                </div>
                <button 
                  className={`${styles.toggle} ${localConfig.notificationEnabled ? styles.active : ''}`}
                  onClick={() => handleToggle('notificationEnabled')}
                  disabled={!localConfig.enabled}
                >
                  <span className={styles.toggleThumb} />
                </button>
              </div>
            </div>
          </div>
          
          {/* 阈值设置 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>阈值设置</div>
            <div className={styles.card}>
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>低眨眼阈值</div>
                  <div className={styles.description}>低于此值触发提醒（次/分钟）</div>
                </div>
                <input
                  type="number"
                  className={styles.numberInput}
                  min={5}
                  max={20}
                  value={localConfig.lowBlinkThreshold}
                  onChange={(e) => handleNumberChange('lowBlinkThreshold', parseInt(e.target.value) || 10)}
                />
              </div>
              
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>提醒间隔</div>
                  <div className={styles.description}>两次提醒之间的最小间隔（分钟）</div>
                </div>
                <input
                  type="number"
                  className={styles.numberInput}
                  min={1}
                  max={30}
                  value={localConfig.reminderInterval}
                  onChange={(e) => handleNumberChange('reminderInterval', parseInt(e.target.value) || 5)}
                />
              </div>
            </div>
          </div>
          
          {/* 数据统计 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>数据统计</div>
            <div className={styles.card}>
              <div className={styles.row}>
                <div className={styles.label}>历史会话</div>
                <span>{totalSessions} 次</span>
              </div>
              <div className={styles.row}>
                <div className={styles.label}>累计眨眼</div>
                <span>{totalBlinks.toLocaleString()} 次</span>
              </div>
            </div>
          </div>
          
          {/* 数据管理 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>数据管理</div>
            <div className={styles.card}>
              <div className={styles.row}>
                <div>
                  <div className={styles.label}>导出数据</div>
                  <div className={styles.description}>下载所有会话记录为 JSON</div>
                </div>
                <button className={styles.iconBtn} onClick={handleExport}>
                  ↓
                </button>
              </div>
            </div>
          </div>
          
          {/* 危险区域 */}
          <div className={styles.dangerZone}>
            <div className={styles.dangerTitle}>危险区域</div>
            <button className={styles.dangerBtn} onClick={handleClear}>
              清空所有数据
            </button>
          </div>
        </div>
        
        <div className={styles.footer}>
          <span className={styles.version}>Blink Guardian v1.0</span>
        </div>
      </div>
    </>
  )
}
