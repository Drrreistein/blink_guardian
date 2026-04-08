import { useCallback, useEffect, useRef, useState } from 'react'

export type AlertConfig = {
  enabled: boolean
  visualEnabled: boolean
  soundEnabled: boolean
  notificationEnabled: boolean
  lowBlinkThreshold: number // 低于此值触发提醒 (次/分钟)
  reminderInterval: number // 提醒间隔 (分钟)
}

const DEFAULT_CONFIG: AlertConfig = {
  enabled: true,
  visualEnabled: true,
  soundEnabled: false,
  notificationEnabled: false,
  lowBlinkThreshold: 10,
  reminderInterval: 5,
}

const CONFIG_KEY = 'blink-guardian-alert-config'

export function useAlert() {
  const [config, setConfig] = useState<AlertConfig>(DEFAULT_CONFIG)
  const [isAlerting, setIsAlerting] = useState(false)
  const [alertLevel, setAlertLevel] = useState<'normal' | 'warning' | 'danger'>('normal')
  
  const lastAlertTimeRef = useRef(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  
  // 加载配置
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setConfig({ ...DEFAULT_CONFIG, ...parsed })
      }
    } catch {
      // 忽略
    }
  }, [])
  
  // 保存配置
  const saveConfig = useCallback((newConfig: Partial<AlertConfig>) => {
    setConfig(current => {
      const updated = { ...current, ...newConfig }
      localStorage.setItem(CONFIG_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])
  
  // 请求通知权限
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return false
    const result = await Notification.requestPermission()
    return result === 'granted'
  }, [])
  
  // 播放提醒音
  const playSound = useCallback(() => {
    if (!config.soundEnabled) return
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      }
      
      const ctx = audioContextRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.frequency.value = 800
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
      
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.5)
    } catch {
      // 忽略音频错误
    }
  }, [config.soundEnabled])
  
  // 发送浏览器通知
  const sendNotification = useCallback((title: string, body: string) => {
    if (!config.notificationEnabled) return
    if (Notification.permission !== 'granted') return
    
    try {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        silent: !config.soundEnabled,
      })
    } catch {
      // 忽略
    }
  }, [config.notificationEnabled, config.soundEnabled])
  
  // 触发提醒
  const triggerAlert = useCallback((level: 'warning' | 'danger', message: string) => {
    if (!config.enabled) return
    
    const now = Date.now()
    const minInterval = config.reminderInterval * 60 * 1000
    
    // 检查提醒间隔
    if (now - lastAlertTimeRef.current < minInterval) return
    lastAlertTimeRef.current = now
    
    setAlertLevel(level)
    setIsAlerting(true)
    
    if (config.visualEnabled) {
      // 视觉提醒由 UI 组件处理
    }
    
    playSound()
    sendNotification(
      level === 'danger' ? '眨眼频率过低！' : '该眨眼了',
      message
    )
    
    // 自动关闭视觉提醒
    setTimeout(() => {
      setIsAlerting(false)
    }, 3000)
  }, [config, playSound, sendNotification])
  
  // 检查眨眼频率并触发提醒
  const checkBlinkRate = useCallback((blinkRate: number) => {
    if (!config.enabled) {
      setAlertLevel('normal')
      return
    }
    
    if (blinkRate < config.lowBlinkThreshold * 0.5) {
      setAlertLevel('danger')
      triggerAlert('danger', `当前眨眼频率 ${blinkRate} 次/分钟，严重偏低，请立即眨眼休息！`)
    } else if (blinkRate < config.lowBlinkThreshold) {
      setAlertLevel('warning')
      triggerAlert('warning', `眨眼频率 ${blinkRate} 次/分钟，建议多眨眼保护眼睛`)
    } else {
      setAlertLevel('normal')
    }
  }, [config, triggerAlert])
  
  // 停止提醒
  const stopAlert = useCallback(() => {
    setIsAlerting(false)
  }, [])
  
  return {
    config,
    saveConfig,
    isAlerting,
    alertLevel,
    checkBlinkRate,
    stopAlert,
    requestNotificationPermission,
  }
}
