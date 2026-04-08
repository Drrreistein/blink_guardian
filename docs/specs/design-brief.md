# Blink Guardian - Design Brief

## Visual Identity

### Color Palette
```
Primary:    #0EA5E9 (Sky Blue)     - 主色调，科技感
Secondary:  #10B981 (Emerald)      - 健康/安全指示
Warning:    #F59E0B (Amber)        - 警告/提醒
Danger:     #EF4444 (Red)          - 危险/严重提醒
Background: #0F172A (Slate 900)    - 深色背景
Surface:    #1E293B (Slate 800)    - 卡片/面板
Text:       #F8FAFC (Slate 50)     - 主文字
Muted:      #94A3B8 (Slate 400)    - 次要文字
```

### Typography
- Font: system-ui, -apple-system, sans-serif
- 标题: 18-24px, font-weight 600
- 正文: 14-16px, font-weight 400
- 数据: 32-48px, font-weight 700 (等宽数字)

### Layout Principles
- 桌面小组件风格，不打扰
- 圆角: 12-16px
- 阴影: 柔和多层阴影
- 间距: 16-24px 基础单位

## Component Specifications

### Monitor Widget
- 尺寸: 280px × 160px (展开) / 60px × 60px (最小化)
- 位置: 右下角固定
- 背景: 毛玻璃效果 (backdrop-blur)
- 边框: 1px solid rgba(255,255,255,0.1)

### Alert Indicator
- 屏幕边缘 4px 呼吸灯条
- 正常: 隐藏
- 警告: 黄色呼吸
- 危险: 红色闪烁

### Settings Panel
- 抽屉式从右侧滑入
- 宽度: 360px
- 分组卡片布局

## Animation Guidelines
- 过渡: 200-300ms ease-out
- 呼吸动画: 2s ease-in-out infinite
- 数据更新: 150ms fade
- 减少动画偏好支持

## Resource Constraints
- 目标包大小: < 200KB gzipped
- 检测帧率: 3-5 FPS
- 内存占用: < 50MB
- CPU 使用: 后台时暂停
