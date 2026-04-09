import { useState, useCallback } from 'react'
import { MonitorWidget } from './components/MonitorWidget'
import { SettingsPanel } from './components/SettingsPanel'
import { AlertOverlay } from './components/AlertOverlay'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { Timer202020 } from './components/Timer202020'
import { CameraDebug } from './components/CameraDebug'
import { useAlert } from './hooks/useAlert'
import { useSessionStorage } from './hooks/useSessionStorage'
import './App.css'

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false)
  const [timerEnabled, setTimerEnabled] = useState(true)
  const [showDebug, setShowDebug] = useState(() => {
    return new URLSearchParams(window.location.search).has('debug')
  })
  
  const { 
    config, 
    saveConfig, 
    isAlerting, 
    alertLevel, 
    stopAlert,
    requestNotificationPermission,
  } = useAlert()
  
  const { sessions, currentSession, exportData, clearAll } = useSessionStorage()
  
  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true)
    if (config.notificationEnabled) {
      void requestNotificationPermission()
    }
  }, [config.notificationEnabled, requestNotificationPermission])
  
  const handleSaveConfig = useCallback((newConfig: Parameters<typeof saveConfig>[0]) => {
    saveConfig(newConfig)
    if ('notificationEnabled' in newConfig && newConfig.notificationEnabled) {
      void requestNotificationPermission()
    }
  }, [saveConfig, requestNotificationPermission])
  
  return (
    <div className="app">
      {/* Main content */}
      <main className="main">
        <div className="hero">
          <h1 className="title">BLINK GUARDIAN</h1>
          <p className="subtitle">Eye Health Monitor</p>
          
          <div className="features">
            <div className="feature">Real-time Detection</div>
            <div className="feature">Data Analytics</div>
            <div className="feature">Smart Alerts</div>
          </div>
          
          <div className="status">
            <div className={`statusDot ${alertLevel}`} />
            <span className="statusText">
              {alertLevel === 'normal' ? 'System Active' : 
               alertLevel === 'warning' ? 'Low Blink Rate' : 
               'Critical Alert'}
            </span>
          </div>
        </div>
        
        <div className="tips">
          <h2>Eye Care Guidelines</h2>
          <ul>
            <li>Normal blink rate is 15-20 times per minute</li>
            <li>Computer use typically reduces blinking to 5-7 times per minute</li>
            <li>Follow the 20-20-20 rule: Every 20 minutes, look 20 feet away for 20 seconds</li>
            <li>Maintain 50-70cm distance from your screen</li>
            <li>Use artificial tears to relieve dry eye symptoms</li>
          </ul>
        </div>
      </main>
      
      {/* Monitor Widget */}
      <MonitorWidget 
        onOpenSettings={handleOpenSettings}
        onOpenAnalytics={() => setIsAnalyticsOpen(true)}
      />
      
      {/* 20-20-20 Timer */}
      <Timer202020 enabled={timerEnabled} />
      
      {/* Settings Panel */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        alertConfig={config}
        onSaveAlertConfig={handleSaveConfig}
        sessions={sessions}
        onExportData={exportData}
        onClearAll={clearAll}
        timerEnabled={timerEnabled}
        onToggleTimer={() => setTimerEnabled(!timerEnabled)}
      />
      
      {/* Analytics Panel */}
      <AnalyticsPanel
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        sessions={sessions}
        currentSession={currentSession}
      />
      
      {/* Alert Overlay */}
      <AlertOverlay
        isActive={isAlerting}
        level={alertLevel}
        visualEnabled={config.visualEnabled}
        onDismiss={stopAlert}
      />
      
      {/* Debug Tool */}
      {showDebug && <CameraDebug />}
      
      {/* Debug Toggle Button (always visible) */}
      <button
        onClick={() => setShowDebug(!showDebug)}
        style={{
          position: 'fixed',
          bottom: '8px',
          right: '12px',
          background: '#222',
          color: showDebug ? '#0f0' : '#666',
          border: '1px solid #444',
          padding: '4px 10px',
          fontFamily: 'monospace',
          fontSize: '10px',
          cursor: 'pointer',
          zIndex: 10001,
        }}
      >
        {showDebug ? 'DEBUG ON' : 'DEBUG'}
      </button>
    </div>
  )
}

export default App
