# Blink Guardian - Feature List

## Sprint 1: Core Detection (P0)

### Feature 1: Camera Module
- 低分辨率摄像头访问 (320x240)
- 权限处理和错误提示
- 可隐藏预览窗口
- 页面隐藏自动暂停

### Feature 2: Blink Detection Engine
- MediaPipe Face Landmark 集成
- EAR (Eye Aspect Ratio) 算法
- 眨眼状态判断逻辑
- 3-5 FPS 检测频率控制

### Feature 3: Real-time Monitor Panel
- 当前眨眼频率显示
- 实时状态指示器 (颜色编码)
- 最近眨眼时间
- 最小化/展开切换

### Feature 4: Alert System
- 视觉提醒 (屏幕边缘呼吸灯)
- 声音提醒 (可选)
- 浏览器通知 (可选)
- 可配置提醒阈值

### Feature 5: Session Data Storage
- localStorage 数据持久化
- 会话记录结构
- 30天自动清理
- 数据导出准备

## Sprint 2: Analytics & Tools (P1)

### Feature 6: Analytics Dashboard
- 日/周/月趋势图表
- 平均眨眼频率统计
- 干眼风险评分
- 历史会话列表

### Feature 7: 20-20-20 Timer
- 每20分钟提醒
- 看20英尺外20秒
- 与眨眼检测联动

### Feature 8: Settings & Personalization
- 提醒阈值设置
- 声音/通知开关
- 主题切换
- 数据管理

## Sprint 3: Polish (P2)

### Feature 9: Data Export
- JSON/CSV 导出
- 数据备份/恢复

### Feature 10: PWA Support
- Service Worker
- 离线使用
- 安装提示
