---
name: 1688-distribution
description: "1688 分销工作台铺货自动化 — 通过浏览器操作 1688 分销工作台的【1688复制】功能进行批量铺货"
version: 1.0.0
author: Hermes Agent
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [1688, 分销, 铺货, 电商, 自动化]
---

# 1688 分销工作台铺货自动化

通过浏览器操作 1688 分销工作台的 **1688复制** 功能，实现批量商品铺货到淘宝店铺。

## 触发条件

用户说以下关键词时触发：
- "1688分销铺货"、"1688铺货"、"分销铺货"
- "帮我铺货"、"开始铺货"
- 从选品结果（my-title）获取后需要执行铺货

## 前置条件

1. **浏览器可用** — 需要 `browser` toolset 已启用
2. **1688 账号登录** — **优先通过 CDP 连接用户本地已登录的 Chrome**（见下方"登录方案"）
3. **铺货内容** — 用户直接提供 或 从选品结果中获取

## 登录方案（重要！按优先级选择）

### 方案 A：Browser Relay 通过 Chrome 扩展（推荐 ✅✅）

**不关闭任何 Chrome 窗口，直接操控已登录的标签页。** 这是最佳方案。

原理：利用 OpenClaw Browser Relay Chrome 扩展 + 自建中继服务器，让 Hermes 通过标准 CDP 协议操控用户当前正在使用的 Chrome 标签页。

```
Hermes browser_tool ──CDP WS──► 中继服务器 ◄──WS──► Chrome 扩展(chrome.debugger)
                                                    ▼
                                            用户已登录的 Chrome 标签页
```

**前置条件：**
- 已安装 OpenClaw（扩展位于 `~/.openclaw/browser/chrome-extension/`）
- **Windows 侧有 Node.js v18+**（用于运行中继服务器，见 `browser-relay` skill）

**操作步骤：**

1. **启动中继服务器**（必须用 Node.js 在 Windows 侧运行！详见 `browser-relay` skill）：
   ```bash
   # 复制文件 + 安装依赖 + 启动（首次）
   mkdir -p /mnt/c/temp/relay
   cp ~/.hermes/browser-relay/relay-server.js /mnt/c/temp/relay/
   /mnt/c/Windows/System32/cmd.exe /c "cd /d C:\temp\relay && npm init -y && npm install ws"
   # 启动
   /mnt/c/Windows/System32/cmd.exe /c "cd /d C:\temp\relay && node relay-server.js --port 19876 --token hermes-relay-2026"
   ```
2. **在 Chrome 中加载扩展**：
   - 打开 `chrome://extensions`
   - 开启「开发者模式」→「加载已解压的扩展程序」
   - 选择目录：`~/.openclaw/browser/chrome-extension/`
3. **配置扩展**：右键扩展图标 → 选项 → 设置 Port 和 Token（与中继服务器一致）
4. **附加标签页**：打开 1688 分销工作台页面 → 点击扩展图标 → 徽章显示橙色 **ON**
5. **连接 Hermes**：设置 `BROWSER_CDP_URL=http://127.0.0.1:<port>`
6. 正常使用 `browser_navigate`、`browser_click` 等工具操作该标签页

> 📖 完整部署指南和代码见 `references/browser-relay.md`

### 方案 B：CDP 连接本地 Chrome（需重启 Chrome）

Hermes 支持通过 Chrome DevTools Protocol (CDP) 连接用户本地已打开的浏览器，**直接共享 Cookie 和登录状态**，无需重新登录。

**操作步骤：**

1. 让用户**完全关闭所有 Chrome 窗口和进程**
   - 关闭所有 Chrome 窗口
   - 任务管理器（`Ctrl+Shift+Esc`）结束所有 chrome.exe 进程
   - ⚠️ **必须完全关闭**，否则 `--remote-debugging-port` 参数会被忽略（Chrome 会复用已有进程）

2. 以调试模式重新启动 Chrome：
   ```bash
   # 从 WSL 启动 Windows Chrome
   /mnt/c/Windows/System32/cmd.exe /c 'start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222'
   ```

3. 验证端口就绪：
   ```bash
   curl -s http://localhost:9222/json/version
   ```

4. 设置 CDP URL 并连接：
   - 设置环境变量 `BROWSER_CDP_URL=http://localhost:9222`
   - 或在 config.yaml 中设置 `browser.cdp_url: http://localhost:9222`
   - 之后所有 `browser_navigate` 等操作都会使用用户的本地 Chrome

5. 打开 1688 分销工作台页面 → 应该已自动登录 ✅

> ⚠️ 此方案需要**关闭并重启 Chrome**。如果用户不想关闭 Chrome，优先用**方案 A（Browser Relay）**。

### 方案 C：独立 Profile 启动调试 Chrome（不需关闭主 Chrome）

复制用户的 Chrome Profile 到新目录，用独立 Profile 启动带调试端口的 Chrome。

**不需要关闭用户正在使用的 Chrome！** 步骤如下：

#### Step 1: 复制关键登录文件到新 Profile 目录

```
# 用户 Windows 路径（WSL 下）
PROFILE_SRC="/mnt/c/Users/<Windows用户名>/AppData/Local/Google/Chrome/User Data"
PROFILE_DST="/mnt/c/Users/<Windows用户名>/chrome_profile_1688"
mkdir -p "$PROFILE_DST/Default"

# 复制关键文件
for f in \
  "Local State" \
  "Default/Preferences" \
  "Default/Login Data" \
  "Default/Web Data" \
  "Default/Network/Cookies" \
  "Default/History" \
; do
  cp "$PROFILE_SRC/$f" "$PROFILE_DST/$f" 2>/dev/null
done

# 复制 Local Storage / Session Storage / IndexedDB
cp -r "$PROFILE_SRC/Default/Local Storage" "$PROFILE_DST/Default/" 2>/dev/null
cp -r "$PROFILE_SRC/Default/Session Storage" "$PROFILE_DST/Default/" 2>/dev/null
cp -r "$PROFILE_SRC/Default/IndexedDB" "$PROFILE_DST/Default/" 2>/dev/null
```

> ⚠️ **注意**：`Default/Cookies` 文件在 Chrome 运行时被锁定，无法复制。这可能导致部分网站的登录状态无法继承。1688 的登录主要依赖 Network/Cookies + Local Storage，通常够用。

#### Step 2: 用 PowerShell 启动带调试端口的 Chrome

```bash
# ✅ 这个方式有效（cmd.exe /c start 不一定有效）
powershell.exe -Command "Start-Process 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' \
  -ArgumentList '--remote-debugging-port=9222','--user-data-dir=C:\\Users\\<用户名>\\chrome_profile_1688'"
```

#### Step 3-4: 验证端口并设置环境变量（同方案 B）

> ⚠️ **Profile 复制可能丢失登录状态**（Cookies 文件被锁定）。如果登录未生效，需在新窗口手动登录一次。**更可靠的方案是方案 A（Browser Relay）**。

### 方案 D：内置浏览器 + 手动登录（最后备选）

如果以上方式都不可用，使用内置浏览器（Browserbase/Camofox），但这是独立实例，**不共享用户 Cookie**，需要：
- 扫码登录（截图给用户扫）
- 或短信验证码登录
- 或密码登录

> ⚠️ 内置浏览器每次新会话可能需要重新登录，不适合频繁使用。

## 页面地址

```
https://air.1688.com/app/channel-fe/distribution-work/ai-assistant.html#/multi-agent
```

## 操作流程

### Step 0: 检查/处理登录

打开页面后检查是否已登录：
- 如果出现**登录弹窗**（扫码/短信/密码），提示用户选择登录方式
- 用户可选择：
  - A) 扫码登录（用 1688 App / 淘宝 App 扫描二维码）
  - B) 短信验证码登录（用户提供手机号）
  - C) 密码登录（用户提供账号密码）

**注意**：内置浏览器是独立实例，不共享用户本地浏览器的 Cookie。每次新会话可能需要重新登录。

### Step 1: 打开分销工作台页面

```python
browser_navigate(
    url="https://air.1688.com/app/channel-fe/distribution-work/ai-assistant.html#/multi-agent"
)
```

等待页面完全加载（等待左侧菜单出现）。

### Step 2: 定位并悬停【铺货】按钮

1. 用 `browser_snapshot` 获取页面元素，找到左侧菜单中的**【铺货】**按钮
2. 用 `browser_click` 点击该按钮（或用 hover 触发悬停事件）
3. 等待二级菜单出现

**关键点**：【铺货】按钮需要 **hover（悬停）** 才能展开二级菜单，不是 click。如果 click 不行，尝试用 `browser_console` 执行 JS 触发 mouseenter 事件：

```javascript
// 通过 JS 触发悬停事件
const el = document.querySelector('[class*="铺货"]') || 
           Array.from(document.querySelectorAll('*')).find(e => e.textContent.includes('铺货') && e.children.length === 0);
if (el) {
  el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
  'hover triggered';
} else { 'element not found'; }
```

### Step 3: 点击二级菜单中的【1688复制】

1. 二级菜单出现后，找到并点击 **【1688复制】**
2. 等待右侧出现 1688 复制功能区域（包含文本输入框和操作按钮）

### Step 4: 填入铺货内容

1. 找到文本输入框（textarea）
2. 将需要铺货的内容粘贴进去，**每条一行**
3. 内容格式示例：

```
https://detail.1688.com/offer/xxx.html
https://detail.1688.com/offer/yyy.html
https://detail.1688.com/offer/zzz.html
```

也可以是商品标题（系统会自动匹配）。

### Step 5: 点击【开始批量复制】

1. 找到并点击 **【开始批量复制】** 按钮
2. 等待进入铺货确认页面
3. 可能需要等待几秒让系统解析商品信息

### Step 6: 点击【提交复制】

1. 在确认页面找到 **【提交复制】** 按钮
2. 点击完成铺货
3. 等待成功提示

### Step 7: 多次铺货重复

如果有更多商品需要铺货，从 **Step 2** 开始重复。

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `items` | list/string | 是 | 需要铺货的商品链接或标题列表 |
| `shop_name` | string | 否 | 目标淘宝店铺名（用于记录） |

## 输出结果

铺货完成后向用户报告：
- 成功铺货的商品数量
- 各商品的处理状态
- 如有失败项，说明原因

## ⚠️ 跨域 iframe 操作方案（2026-05-21 验证通过 ✅）

### 问题

1688 分销工作台的【1688复制】功能页面使用**跨域 iframe** 嵌入：

```
父页面: air.1688.com (分销工作台)
  └─ iframe: light-app.1688.com (代小发 ERP，2460×1118)
       └─ 实际功能页面（输入框、按钮都在这里）
```

**无法**通过父页面的 `Runtime.evaluate` 访问 iframe 内部 DOM（跨域限制）。
`document.querySelectorAll('iframe')[0].contentDocument` 返回 null 或报错。

### 解决方案：Input.dispatchMouseEvent + 精确坐标点击 ✅

Chrome DevTools Protocol 的 `Input.dispatchMouseEvent` 在**浏览器级别**分发鼠标事件，
可以穿透 iframe 边界，直接命中 iframe 内的元素！

#### 操作流程

```python
# 1. 获取视口尺寸
r = await cdp(ws, "Runtime.evaluate", {
    "expression": "JSON.stringify({w:window.innerWidth,h:window.innerHeight,dpr:window.devicePixelRatio})",
    "returnByValue": True
})
info = json.loads(r['result']['value'])
# info = {'w': 2560, 'h': 1249, 'dpr': 1.0}

# 2. 截图 + 用 vision 工具获取目标元素百分比位置
r = await cdp(ws, "Page.captureScreenshot", {"format": "png"})
save_shot(r['data'], 'screenshot.png')
# → vision_analyze: "按钮中心 [50.3%, 62.4%]"

# 3. 百分比 → 实际像素坐标
btn_x = int(info['w'] * 0.503)  # 1288
btn_y = int(info['h'] * 0.624)  # 779

# 4. 执行完整鼠标点击序列
await cdp(ws, "Input.dispatchMouseEvent", {"type": "mouseMoved", "x": btn_x, "y": btn_y})
await asyncio.sleep(0.3)
await cdp(ws, "Input.dispatchMouseEvent", {"type": "mousePressed", "x": btn_x, "y": btn_y,
    "button": "left", "clickCount": 1})
await asyncio.sleep(0.15)
await cdp(ws, "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": btn_x, "y": btn_y,
    "button": "left", "clickCount": 1})

# 5. 输入文字（Input.insertText 也支持跨域 iframe！）
await click_at(ws, input_x, input_y)  # 先点击输入框获取焦点
await cdp(ws, "Input.insertText", {"text": "https://detail.1688.com/offer/xxx.html"})
```

#### ⚠️ 坐标获取关键注意事项

1. **必须用百分比！** vision 工具给出的原始像素坐标不准确
2. **每次操作前重新截图获取坐标** — 窗口大小变化后坐标失效
3. **DPR 通常为 1** — 但要检查 `window.devicePixelRatio`
4. **截图像素 = 视口 CSS 像素 × DPR**

#### 已验证的完整铺货坐标参考 (2560×1249 视口)

| 步骤 | 目标元素 | 百分比位置 | 像素坐标 |
|------|---------|-----------|---------|
| 点击输入框 | 链接文本输入区 | ~[50%, 26%] | ~(1280, 324) |
| 开始批量复制 | 蓝色主按钮 | [50.3%, 62.4%] | (1288, 779) |
| 提交复制 | 蓝色提交按钮 | [47.6%, 96.5%] | (1219, 1205) |

> ⚠️ 以上坐标仅作参考，**实际使用时必须重新截图+vision分析获取**！

## 注意事项与坑点

> 📖 **Browser Relay 完整部署指南**: `references/browser-relay.md`
> 📖 **websockets 16.x API 变更调试记录**: `references/websockets16-process-request-gotcha.md`
> 📖 **中继服务器代码模板**: `templates/relay_server.py`

### 1. 浏览器连接方式 — 按优先级选择

| 方案 | 需要关闭 Chrome? | 登录状态 | 推荐度 |
|------|-----------------|---------|--------|
| **A: Browser Relay** (Chrome 扩展) | ❌ 不需要 | ✅ 100% 继承 | ⭐⭐⭐ **首选** |
| **B: CDP + 重启 Chrome** | ✅ 需要 | ✅ 继承 | ⭐⭐ 备选 |
| **C: 独立 Profile 启动** | ❌ 不需要 | ⚠️ 可能丢失 | ⭐ 勉强 |
| **D: 内置浏览器** | N/A | ❌ 需重新登录 | 最后备选 |

**用户明确偏好：不要关闭 Chrome。优先使用方案 A（Browser Relay）。**

### 2. Browser Relay 关键要点

- 扩展位于 `~/.openclaw/browser/chrome-extension/`（OpenClaw 自带）
- **中继服务器必须用 Node.js 在 Windows 侧运行**（不要用 Python/WSL，WS 连接不稳定）
- 代码文件: `~/.hermes/browser-relay/relay-server.js`
- 运行目录: `C:\temp\relay\`（Windows 侧）
- 依赖: `npm install ws`（通过 cmd.exe /c 安装）
- OpenClaw Gateway 默认占用端口 18791-18792，中继服务器应使用其他端口（如 19876）
- 扩展点击一次 = attach 一个标签页；再次点击 = detach
- 导航后扩展会自动 re-attach（最多重试 3 次，延迟 300/700/1500ms）

### 3. CDP 连接本地 Chrome 的关键坑

- Chrome 必须完全关闭所有进程后重新启动，`--remote-debugging-port` 参数才会生效
- 如果 Chrome 已有实例在运行，新启动的窗口会复用旧进程，**忽略 `--remote-debugging-port`**
- Windows 上有效启动方式：`powershell.exe -Command "Start-Process 'chrome.exe' -ArgumentList '...'"`
- 无效方式：`cmd.exe /c start`、直接 WSL 路径调用

### 4. Hover vs Click

- 左侧菜单的【铺货】是 **hover 展开二级菜单**，不是 click
- `browser_click` 可能无法触发 hover 效果
- **备用方案**：用 `browser_console` 执行 JS 的 `mouseenter` 事件

### 3. 页面加载等待
- 1688 分销工作台是 SPA（单页应用），路由切换后需等待 DOM 更新
- 每步操作后建议用 `browser_snapshot` 确认元素已加载
- 必要时加 `browser_scroll` 确保目标元素在可视区域

### 4. 文本框定位
- 1688 复制功能的文本框可能是 `textarea`、`div[contenteditable]` 或自定义组件
- 优先用 `browser_type` 填入内容
- 如果 `browser_type` 不生效，用 `browser_console` 直接设值：

```javascript
const textarea = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
if (textarea) {
  textarea.value = '链接1\n链接2\n链接3';
  textarea.dispatchEvent(new Event('input', {bubbles: true}));
  'done';
}
```

### 5. 批量操作限制
- 一次铺货数量可能有上限（通常 20-50 条）
- 超过上限需分批执行
- 注意观察页面的数量提示

### 6. 错误处理
- 商品不存在/下架 → 跳过并记录
- 链接格式错误 → 提示用户修正
- 网络超时 → 重试一次
- 登录过期 → 重新登录后继续

## 完整执行示例

```
用户: 帮我进行1688分销铺货，这些商品：
https://detail.1688.com/offer/123.html
https://detail.1688.com/offer/456.html

Agent 执行流程:
1. browser_navigate → 打开分销工作台
2. 检查登录状态 → 未登录则引导登录
3. hover 【铺货】→ 展开二级菜单
4. click 【1688复制】→ 进入功能页
5. 填入两条链接 → 每条一行
6. click 【开始批量复制】→ 进入确认页
7. click 【提交复制】→ 完成
8. 报告结果: ✅ 成功 2 条
```
