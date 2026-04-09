<p align="center">
  <img src="docs/screenshots/05-hero-wide.png?v=20260409" width="420" alt="Blink Guardian Hero">
</p>

<h1 align="center">BLINK GUARDIAN</h1>

<p align="center">
  <strong>Real-time Eye Blink Monitor</strong> — 用摄像头追踪你的眨眼频率，守护用眼健康
</p>

<p align="center">
  <a href="#-features">功能特性</a> •
  <a href="#-quick-start">快速开始</a> •
  <a href="#-tech-stack">技术架构</a>
</p>

---

## ✨ 为什么需要它

长时间面对屏幕会让人的眨眼频率从正常的 **15-20 次/分钟** 骤降到 **5-7 次/分钟**，导致眼干、疲劳甚至视力损伤。

Blink Guardian 通过浏览器调用摄像头，**实时检测眨眼行为**，当你的眨眼率低于健康阈值时发出提醒，帮你养成健康的用眼习惯。

---

## 🎯 核心功能

### 实时监测面板

极简暗色界面，一眼看清所有关键指标：

<p align="center">
  <img src="docs/screenshots/01-main-dashboard.png?v=20260409" width="360" alt="Main Dashboard">
</p>

- **BPM 大数字**：实时眨眼频率（次/分钟），颜色随健康状态变化（绿色正常 → 橙色警告 → 红色危险）
- **分段进度条**：12 段式可视化当前速率与阈值的距离
- **状态指示器**：NORMAL / WARNING / DANGER 三级状态
- **累计统计**：TOTAL 眨眼次数 + ELAPSED 监测时长
- **眼睛状态图标**：实时显示睁眼/闭眼 + EAR 数值

### 全局监测模式

点击 `⬚` 按钮，监测窗口变为 **PiP 浮窗**置顶于所有窗口之上。切换到其他应用或标签页，眨眼监测也不会中断——数据实时回传到主页面。

<p align="center">
  <img src="docs/screenshots/global-mode.png?v=20260409" width="360" alt="Global Mode PiP">
</p>

### 智能提醒系统

三级阈值触发 + 四种提醒方式（均可独立开关）：

| 级别 | 条件 | 行为 |
|------|------|------|
| 🟢 Normal | BPM ≥ 阈值 | 一切正常 |
| 🟡 Warning | 阈值的 50% ≤ BPM < 阈值 | 视觉提示 + 屏幕边缘闪烁 |
| 🔴 Danger | BPM < 阈值的 50% | 强制弹窗 + 声音报警 |

视觉提醒 / 声音提醒 / 浏览器通知 / **20-20-20 定时器**（每 20 分钟提醒远眺）

---

## 🚀 Quick Start

```bash
git clone https://github.com/drrreistein/blink_guardian.git
cd blink_guardian && npm install && npm run dev
```

打开 `http://localhost:5174`，允许摄像头权限即可。

> 需要 HTTPS 或 localhost 环境才能调用摄像头。线上版已部署在 [drrreistein.github.io/blink_guardian](https://drrreistein.github.io/blink_guardian/)。

## 🏗 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | React 19 + TypeScript |
| **构建** | Vite |
| **样式** | CSS Modules (纯手写暗色主题) |
| **检测** | MediaPipe Face Mesh (WASM，浏览器端运行) |
| **算法** | EAR 眨眼检测 + 滑动窗口去抖 |
| **全局模式** | Picture-in-Picture API + postMessage 跨窗口通信 |

```
摄像头帧 → MediaPipe Face Mesh (468 个面部关键点)
         → 提取左右眼各 6 个关键点 → 计算 EAR 值
         → 滑动窗口平滑 + 阈值判断
         → 输出: isBlinking / blinkRate / blinkCount
```

## 📁 项目结构

```
src/
├── components/
│   ├── MonitorWidget.tsx       # 主监控面板
│   ├── SettingsPanel.tsx       # 设置面板
│   ├── AnalyticsPanel.tsx      # 数据分析
│   └── Timer202020.tsx         # 20-20-20 定时器
├── hooks/
│   ├── useBlinkDetector.ts     # 眨眼检测核心 (MediaPipe + EAR)
│   ├── useGlobalMode.ts        # 全局模式 / PiP 管理
│   ├── useAlert.ts             # 提醒逻辑 (三级阈值)
│   └── useSessionStorage.ts    # 会话数据持久化
└── utils/
    ├── eyeGeometry.ts          # EAR 计算几何工具
    └── calibration.ts          # 标定工具
```

## 📄 License

MIT © 2026 drrreistein
