import { useState, useMemo } from 'react'
import type { SessionRecord } from '../hooks/useSessionStorage'
import styles from './AnalyticsPanel.module.css'

interface AnalyticsPanelProps {
  isOpen: boolean
  onClose: () => void
  sessions: SessionRecord[]
  currentSession: SessionRecord | null
}

type Period = 'day' | 'week' | 'month'

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) return `${hours}小时${minutes}分`
  return `${minutes}分钟`
}

function calculateRiskScore(sessions: SessionRecord[]): { score: number; level: 'low' | 'medium' | 'high' } {
  if (sessions.length === 0) return { score: 0, level: 'low' }
  
  const avgRate = sessions.reduce((sum, s) => sum + s.avgBlinkRate, 0) / sessions.length
  
  if (avgRate >= 15) return { score: 20, level: 'low' }
  if (avgRate >= 10) return { score: 50, level: 'medium' }
  return { score: 80, level: 'high' }
}

export function AnalyticsPanel({ isOpen, onClose, sessions, currentSession }: AnalyticsPanelProps) {
  const [period, setPeriod] = useState<Period>('week')
  
  const allSessions = useMemo(() => {
    const list = [...sessions]
    if (currentSession) {
      list.unshift({ ...currentSession, endTime: Date.now() })
    }
    return list.sort((a, b) => b.startTime - a.startTime)
  }, [sessions, currentSession])
  
  const stats = useMemo(() => {
    if (allSessions.length === 0) return null
    
    const totalSessions = allSessions.length
    const totalBlinks = allSessions.reduce((sum, s) => sum + s.totalBlinks, 0)
    const totalDuration = allSessions.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
    const avgRate = allSessions.reduce((sum, s) => sum + s.avgBlinkRate, 0) / totalSessions
    
    return { totalSessions, totalBlinks, totalDuration, avgRate }
  }, [allSessions])
  
  const chartData = useMemo(() => {
    if (allSessions.length === 0) return []
    
    const now = Date.now()
    const days = period === 'day' ? 1 : period === 'week' ? 7 : 30
    const cutoff = now - days * 24 * 60 * 60 * 1000
    
    const filtered = allSessions.filter(s => s.startTime > cutoff)
    
    // 按日期分组
    const grouped = new Map<string, { total: number; count: number }>()
    
    filtered.forEach(session => {
      const date = formatDate(session.startTime)
      const existing = grouped.get(date) || { total: 0, count: 0 }
      existing.total += session.avgBlinkRate
      existing.count += 1
      grouped.set(date, existing)
    })
    
    // 生成图表数据（最近 days 天）
    const data: { label: string; value: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000)
      const label = `${date.getMonth() + 1}/${date.getDate()}`
      const group = grouped.get(label)
      data.push({
        label,
        value: group ? Math.round(group.total / group.count) : 0,
      })
    }
    
    return data
  }, [allSessions, period])
  
  const risk = useMemo(() => calculateRiskScore(allSessions), [allSessions])
  
  const recentSessions = useMemo(() => allSessions.slice(0, 10), [allSessions])
  
  const maxChartValue = useMemo(() => {
    return Math.max(...chartData.map(d => d.value), 20)
  }, [chartData])
  
  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.open : ''}`} onClick={onClose} />
      <div className={`${styles.panel} ${isOpen ? styles.open : ''}`}>
        <div className={styles.header}>
          <span className={styles.title}>数据分析</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        
        <div className={styles.content}>
          {allSessions.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>📊</div>
              <div className={styles.emptyText}>暂无数据，开始监测后会显示分析</div>
            </div>
          ) : (
            <>
              {/* 统计概览 */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>概览</div>
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statValue}>{stats?.totalSessions || 0}</div>
                    <div className={styles.statLabel}>监测次数</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statValue}>{(stats?.totalBlinks || 0).toLocaleString()}</div>
                    <div className={styles.statLabel}>累计眨眼</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statValue}>{formatDuration(stats?.totalDuration || 0)}</div>
                    <div className={styles.statLabel}>总时长</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statValue}>{Math.round(stats?.avgRate || 0)}</div>
                    <div className={styles.statLabel}>平均频率</div>
                  </div>
                </div>
              </div>
              
              {/* 风险评分 */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>干眼风险评估</div>
                <div className={styles.riskCard}>
                  <div className={`${styles.riskScore} ${styles[risk.level]}`}>
                    {risk.score}
                  </div>
                  <div className={styles.riskInfo}>
                    <div className={styles.riskTitle}>
                      {risk.level === 'low' ? '风险较低' : risk.level === 'medium' ? '中等风险' : '风险较高'}
                    </div>
                    <div className={styles.riskDesc}>
                      {risk.level === 'low' 
                        ? '你的眨眼频率正常，继续保持良好的用眼习惯。' 
                        : risk.level === 'medium' 
                          ? '眨眼频率略低，建议增加眨眼次数，多休息。' 
                          : '眨眼频率严重不足，建议立即采取措施保护眼睛。'}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 趋势图表 */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>眨眼频率趋势</div>
                <div className={styles.chartCard}>
                  <div className={styles.chartHeader}>
                    <span className={styles.chartTitle}>平均眨眼频率 (次/分钟)</span>
                    <div className={styles.periodTabs}>
                      <button 
                        className={`${styles.periodTab} ${period === 'day' ? styles.active : ''}`}
                        onClick={() => setPeriod('day')}
                      >
                        日
                      </button>
                      <button 
                        className={`${styles.periodTab} ${period === 'week' ? styles.active : ''}`}
                        onClick={() => setPeriod('week')}
                      >
                        周
                      </button>
                      <button 
                        className={`${styles.periodTab} ${period === 'month' ? styles.active : ''}`}
                        onClick={() => setPeriod('month')}
                      >
                        月
                      </button>
                    </div>
                  </div>
                  {chartData.length > 0 ? (
                    <div className={styles.chart}>
                      {chartData.map((item, index) => (
                        <div
                          key={index}
                          className={styles.bar}
                          style={{
                            height: `${(item.value / maxChartValue) * 100}%`,
                            opacity: item.value > 0 ? 1 : 0.3,
                          }}
                        >
                          <div className={styles.barTooltip}>
                            {item.label}: {item.value}次/分
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.emptyChart}>暂无数据</div>
                  )}
                </div>
              </div>
              
              {/* 历史会话 */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>最近会话</div>
                <div className={styles.sessionList}>
                  {recentSessions.map(session => (
                    <div key={session.id} className={styles.sessionItem}>
                      <div className={styles.sessionInfo}>
                        <div className={styles.sessionDate}>
                          {new Date(session.startTime).toLocaleString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className={styles.sessionDuration}>
                          时长: {formatDuration(session.endTime - session.startTime)}
                        </div>
                      </div>
                      <div className={styles.sessionStats}>
                        <div className={styles.sessionBlinkRate}>
                          {Math.round(session.avgBlinkRate)}次/分
                        </div>
                        <div className={styles.sessionBlinks}>
                          {session.totalBlinks}次眨眼
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
