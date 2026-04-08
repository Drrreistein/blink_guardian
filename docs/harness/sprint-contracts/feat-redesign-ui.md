# Sprint Contract: UI Redesign - Nothing Design Style

## Feature ID
`feat-redesign-ui`

## Sprint Goal
使用 Nothing Design System 重新设计 Blink Guardian 的整个用户界面，从现有的蓝绿色医疗风格转变为单色工业风格。

## Design System Reference
- **Skill**: nothing-design (已安装于 ~/.workbuddy/skills/nothing-design)
- **Philosophy**: Subtract don't add, Structure is ornament, Monochrome canvas
- **Fonts**: Space Grotesk + Space Mono + Doto (Google Fonts)

## Visual Requirements

### 1. Color Palette (Monochrome)
```
Background:    #000000 (OLED Black)
Surface:       #111111 / #1A1A1A
Border:        #333333
Text Primary:  #FFFFFF (100%)
Text Secondary:#999999 (60%)
Text Disabled: #666666 (40%)
Accent:        #D71921 (Nothing Red - 仅用于紧急状态)
```

### 2. Typography
- **Display**: Doto (hero numbers, 48-96px)
- **Primary**: Space Grotesk (headlines, body)
- **Secondary**: Space Mono ALL CAPS (labels, metadata)
- **Max 2 font families per screen**
- **Max 3 font sizes per screen**

### 3. Three-Layer Hierarchy
| Layer | Content | Style |
|-------|---------|-------|
| Primary | 眨眼频率数值 | Doto 64px, white |
| Secondary | 状态标签、单位 | Space Grotesk 16px |
| Tertiary | 时间戳、元数据 | Space Mono 12px ALL CAPS |

### 4. Component Redesign

#### Monitor Widget (监控面板)
- 工业仪表风格
- 分段式进度条代替圆形指示器
- 点阵数字显示风格
- 机械开关样式的控制按钮

#### Alert Indicator (提醒指示器)
- 屏幕边缘分段式呼吸灯
- 红色点阵闪烁（紧急状态）
- 避免渐变和阴影

#### Settings Panel (设置面板)
- 极简卡片布局
- 机械拨动开关
- 清晰的视觉分组（间距而非边框）

## Technical Requirements

### Fonts Loading (index.html)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700&family=Space+Grotesk:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### CSS Variables
```css
:root {
  --bg-primary: #000000;
  --bg-surface: #111111;
  --border: #333333;
  --text-display: #FFFFFF;
  --text-primary: #E5E5E5;
  --text-secondary: #999999;
  --text-disabled: #666666;
  --accent-red: #D71921;
  --font-display: 'Doto', monospace;
  --font-primary: 'Space Grotesk', sans-serif;
  --font-mono: 'Space Mono', monospace;
}
```

## Files to Modify
1. `index.html` - 添加 Google Fonts
2. `src/App.css` - 全局样式、CSS 变量
3. `src/App.tsx` - 主布局结构
4. `src/components/MonitorWidget.tsx` - 监控面板重设计
5. `src/components/AlertIndicator.tsx` - 提醒指示器重设计

## Anti-Patterns to Avoid
- ❌ 渐变背景
- ❌ 阴影和模糊效果
- ❌ 圆角大于 16px（按钮用 pill 或 4-8px）
- ❌ 多色图标
- ❌ 骨架屏 loading
- ❌ Toast 弹窗（用内联状态文字）

## Acceptance Criteria (Definition of Done)

### Visual
- [ ] 页面使用 OLED 黑色背景 (#000000)
- [ ] 正确加载 Space Grotesk + Space Mono + Doto 字体
- [ ] 三层视觉层次清晰可辨
- [ ] 无渐变、无阴影、扁平设计
- [ ] 监控面板采用工业仪表风格
- [ ] 提醒使用分段式/点阵风格

### Functional
- [ ] 眨眼检测功能正常工作
- [ ] 监控数据实时更新
- [ ] 提醒系统在阈值触发时正常工作
- [ ] 设置面板可正常打开/关闭
- [ ] 响应式布局适配移动端

### Code Quality
- [ ] TypeScript 无类型错误
- [ ] ESLint 无警告
- [ ] 无 console.log 残留

## E2E Test Scenarios
1. 页面加载后显示 Nothing Design 风格界面
2. 字体正确渲染（Space Grotesk 用于正文，Space Mono 用于标签）
3. 眨眼频率数值使用 Doto 字体大字号显示
4. 监控面板显示为工业仪表风格
5. 提醒触发时显示分段式红色指示器
6. 设置面板从右侧滑入，使用机械开关
7. 整体布局响应式正常

## Estimation
- **Estimated Time**: 2-3 hours
- **Complexity**: Medium
- **Risk**: Low (visual changes only, no logic changes)

## Dependencies
- None (pure UI redesign)

## Notes
- 保持现有功能逻辑不变，仅修改视觉呈现
- MediaPipe 检测逻辑无需改动
- 状态管理和数据流保持原样
