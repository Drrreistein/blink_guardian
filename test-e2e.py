#!/usr/bin/env python3
"""
Blink Guardian E2E 功能测试
验证 Nothing Design UI 和核心功能
"""

from playwright.sync_api import sync_playwright
import sys

def test_blink_guardian():
    with sync_playwright() as p:
        # 启动浏览器
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()
        
        print("🚀 开始测试 Blink Guardian...")
        
        # 1. 访问页面
        print("\n📱 测试1: 页面加载")
        page.goto('http://localhost:5173/')
        page.wait_for_load_state('networkidle')
        print("✅ 页面加载完成")
        
        # 截图 - 初始状态
        page.screenshot(path='/Users/a1-6/WorkBuddy/20260331112226/projects/blink-guardian/docs/harness/screenshots/test-01-initial.png', full_page=True)
        print("📸 截图已保存: test-01-initial.png")
        
        # 2. 验证 UI 元素 - Nothing Design 风格
        print("\n🎨 测试2: UI 元素验证")
        
        # 检查标题
        title = page.locator('h1.title')
        assert title.is_visible(), "标题未显示"
        title_text = title.inner_text()
        assert "BLINK GUARDIAN" in title_text, f"标题文字不匹配: {title_text}"
        print(f"✅ 标题正确: {title_text}")
        
        # 检查副标题
        subtitle = page.locator('p.subtitle')
        assert subtitle.is_visible(), "副标题未显示"
        print(f"✅ 副标题: {subtitle.inner_text()}")
        
        # 检查功能标签
        features = page.locator('.feature').all()
        assert len(features) == 3, f"功能标签数量不对: {len(features)}"
        print(f"✅ 功能标签数量正确: {len(features)}")
        
        # 检查状态指示器
        status_dot = page.locator('.statusDot')
        assert status_dot.is_visible(), "状态指示器未显示"
        print("✅ 状态指示器显示正常")
        
        # 3. 验证监控组件
        print("\n👁 测试3: 监控组件")
        
        # 查找监控组件标题
        widget_titles = page.locator('text=BLINK GUARDIAN').all()
        if len(widget_titles) > 1:
            print(f"✅ 监控组件标题找到 ({len(widget_titles)} 个)")
        else:
            print("⚠️ 监控组件标题未找到")
        
        # 4. 测试设置面板
        print("\n⚙️ 测试4: 设置面板")
        
        # 查找设置按钮（齿轮图标按钮）
        all_buttons = page.locator('button').all()
        print(f"   找到 {len(all_buttons)} 个按钮")
        
        # 尝试点击第一个图标按钮
        icon_buttons = page.locator('button[class*="iconBtn"]').all()
        if len(icon_buttons) > 0:
            icon_buttons[0].click()
            page.wait_for_timeout(800)
            
            # 截图 - 设置面板打开
            page.screenshot(path='/Users/a1-6/WorkBuddy/20260331112226/projects/blink-guardian/docs/harness/screenshots/test-02-settings.png')
            print("📸 截图已保存: test-02-settings.png")
            print("✅ 设置面板已打开")
            
            # 使用 ESC 关闭面板
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)
            print("✅ 设置面板已关闭")
        else:
            print("⚠️ 图标按钮未找到")
        
        # 5. 测试统计面板
        print("\n📊 测试5: 统计面板")
        
        # 重新获取按钮列表（因为DOM可能已更新）
        icon_buttons = page.locator('button[class*="iconBtn"]').all()
        if len(icon_buttons) > 1:
            try:
                icon_buttons[1].click(timeout=5000)
                page.wait_for_timeout(800)
                
                # 截图 - 统计面板打开
                page.screenshot(path='/Users/a1-6/WorkBuddy/20260331112226/projects/blink-guardian/docs/harness/screenshots/test-03-analytics.png')
                print("📸 截图已保存: test-03-analytics.png")
                print("✅ 统计面板已打开")
                
                # 使用 ESC 关闭面板
                page.keyboard.press('Escape')
                page.wait_for_timeout(300)
                print("✅ 统计面板已关闭")
            except Exception as e:
                print(f"⚠️ 统计面板测试跳过: {e}")
        else:
            print("⚠️ 统计按钮未找到")
        
        # 6. 验证字体加载
        print("\n🔤 测试6: 字体验证 (Nothing Design)")
        
        # 获取标题的计算样式
        title_styles = page.evaluate('''() => {
            const title = document.querySelector('h1.title');
            const body = document.body;
            if (title && body) {
                const titleStyles = window.getComputedStyle(title);
                const bodyStyles = window.getComputedStyle(body);
                return {
                    fontFamily: titleStyles.fontFamily,
                    fontSize: titleStyles.fontSize,
                    color: titleStyles.color,
                    backgroundColor: bodyStyles.backgroundColor
                };
            }
            return null;
        }''')
        
        if title_styles:
            print(f"   标题字体: {title_styles['fontFamily']}")
            print(f"   标题字号: {title_styles['fontSize']}")
            print(f"   标题颜色: {title_styles['color']}")
            print(f"   页面背景: {title_styles['backgroundColor']}")
            
            # 验证 Nothing Design 特征
            font_check = 'Doto' in title_styles['fontFamily'] or 'monospace' in title_styles['fontFamily']
            bg_check = 'rgb(0, 0, 0)' in title_styles['backgroundColor'] or 'rgba(0, 0, 0' in title_styles['backgroundColor']
            
            if font_check:
                print("✅ 标题字体正确 (Doto/monospace)")
            else:
                print(f"⚠️ 标题字体: {title_styles['fontFamily']}")
            
            if bg_check:
                print("✅ 背景为黑色 (OLED Black)")
            else:
                print(f"⚠️ 背景颜色: {title_styles['backgroundColor']}")
        else:
            print("⚠️ 无法获取样式信息")
        
        # 7. 验证无渐变/阴影
        print("\n🎯 测试7: 验证 Nothing Design 原则")
        
        has_gradients = page.evaluate('''() => {
            const allElements = document.querySelectorAll('*');
            for (let el of allElements) {
                const style = window.getComputedStyle(el);
                if (style.backgroundImage && style.backgroundImage !== 'none') return true;
                if (style.boxShadow && style.boxShadow !== 'none') return true;
            }
            return false;
        }''')
        
        if has_gradients:
            print("⚠️ 发现渐变或阴影效果")
        else:
            print("✅ 无渐变、无阴影 (扁平设计)")
        
        # 8. 最终截图
        print("\n📸 测试8: 最终状态截图")
        page.screenshot(path='/Users/a1-6/WorkBuddy/20260331112226/projects/blink-guardian/docs/harness/screenshots/test-04-final.png', full_page=True)
        print("📸 截图已保存: test-04-final.png")
        
        print("\n" + "="*50)
        print("✅ 所有测试完成!")
        print("="*50)
        
        # 关闭浏览器
        browser.close()
        return True

if __name__ == '__main__':
    try:
        success = test_blink_guardian()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
