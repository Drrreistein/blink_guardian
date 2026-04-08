import { useState, useEffect, useCallback } from 'react'

export type SessionRecord = {
  id: string
  startTime: number
  endTime: number
  totalBlinks: number
  avgBlinkRate: number
  alertsTriggered: number
}

const STORAGE_KEY = 'blink-guardian-sessions'
const MAX_AGE_DAYS = 30

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function cleanupOldSessions(sessions: SessionRecord[]): SessionRecord[] {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  return sessions.filter(s => s.startTime > cutoff)
}

export function useSessionStorage() {
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  
  // 加载历史会话
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as SessionRecord[]
        setSessions(cleanupOldSessions(parsed))
      }
    } catch {
      // 忽略解析错误
    }
  }, [])
  

  
  // 开始新会话
  const startSession = useCallback(() => {
    const session: SessionRecord = {
      id: generateId(),
      startTime: Date.now(),
      endTime: Date.now(),
      totalBlinks: 0,
      avgBlinkRate: 0,
      alertsTriggered: 0,
    }
    setCurrentSession(session)
    return session.id
  }, [])
  
  // 更新当前会话
  const updateSession = useCallback((updates: Partial<SessionRecord>) => {
    setCurrentSession(prev => {
      if (!prev) return null
      return { ...prev, ...updates, endTime: Date.now() }
    })
  }, [])
  
  // 结束当前会话并保存
  const endSession = useCallback(() => {
    setCurrentSession(prev => {
      if (!prev) return null
      const finalSession = { ...prev, endTime: Date.now() }
      setSessions(current => {
        const updated = cleanupOldSessions([finalSession, ...current])
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        return updated
      })
      return null
    })
  }, [])
  
  // 删除会话
  const deleteSession = useCallback((id: string) => {
    setSessions(current => {
      const updated = current.filter(s => s.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])
  
  // 清空所有数据
  const clearAll = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setSessions([])
    setCurrentSession(null)
  }, [])
  
  // 导出数据
  const exportData = useCallback(() => {
    const data = {
      exportTime: Date.now(),
      sessions: [...sessions, ...(currentSession ? [{ ...currentSession, endTime: Date.now() }] : [])],
    }
    return JSON.stringify(data, null, 2)
  }, [sessions, currentSession])
  
  return {
    currentSession,
    sessions,
    startSession,
    updateSession,
    endSession,
    deleteSession,
    clearAll,
    exportData,
  }
}
