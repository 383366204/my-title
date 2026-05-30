---
name: 1688-distribution
description: "张飞搬家多店复制铺货自动化 — 通过 item.jnesoft.com 的【复制上货】→【多店复制】进行批量铺货"
version: 1.0.0
author: Hermes Agent
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [1688, 分销, 铺货, 电商, 自动化]
---

# 张飞搬家多店复制铺货自动化

通过浏览器操作 `https://item.jnesoft.com/` 的 **复制上货 → 多店复制** 功能，实现批量商品铺货到多个淘宝店铺。1688 工作台入口仅作为兜底，不再作为默认路线。

## 弱模型执行契约（必须遵守）

这个 skill 面向不擅长页面推理的 agent。执行时必须把它当成状态机，不要“看起来差不多就点”：

1. 每一步只做一个动作，动作完成后读取 URL 或页面正文确认。
2. 没拿到本步“通过信号”，不允许进入下一步。
3. 任何包含 `复制` 的入口都不能模糊匹配；入口必须是完整文本 `多店复制`。
4. 任何提交动作只能执行一次；提交后必须去复制日志验证，不允许原地重复点击。
5. 中文输入后必须读回页面内容；只要出现 `????`，立即停止并重填。
6. 如果当前页面不是 `item.jnesoft.com`，先回 `https://item.jnesoft.com/`，不要在 1688 AI 对话页里继续找按钮。

### 逐步验收表

| 步骤 | 动作 | 通过信号 | 失败处理 |
|------|------|----------|----------|
| 0 | 连接用户已登录 Chrome | 能打开 `item.jnesoft.com`，未出现登录弹窗 | 让用户先登录，不要尝试破解登录 |
| 1 | 打开 `https://item.jnesoft.com/` | 页面正文包含 `复制上货` | 刷新一次；仍没有则提示登录或网络异常 |
| 2 | hover `复制上货` | 页面出现精确文本 `多店复制` | 触发 `mouseenter`/`mouseover`；不要点击其它复制入口 |
| 3 | 点击 `多店复制` | URL 含 `ali_multiStore`，或正文含 `商品分配方式` | 直达 `https://item.jnesoft.com/ali_view/ali_multiStore` 兜底 |
| 4 | 填入商品数据 | 编辑器行数等于输入条数，中文完整 | 清空编辑器，用 `execCommand('insertText')` 重填 |
| 5 | 选分配方式 | `随机平均分配` 处于选中状态 | 只点击 `随机平均分配` 所在 radio label |
| 6 | 全选店铺 | 正文出现 `全选：已选 N 个店铺` | 再点一次 `全选`，仍失败则停止 |
| 7 | 提交前校验 | `其中0条不合规`，按钮 `开始批量复制` 可用 | 不提交，报告校验失败内容 |
| 8 | 点击 `开始批量复制` | 已记录本批 batchHash，且只点击一次 | 不重试点击，立刻点击 `查看复制记录` |
| 9 | 点击 `查看复制记录` 并核验 | 进入 `ali_batchLog`，出现新批次，类型为 `多店复制` | 用任一商品 ID 搜索日志确认 |

### 停止条件

出现以下任一情况，agent 必须停止操作并向用户报告，不要继续尝试：

- 未登录，或页面要求短信/扫码/密码登录。
- 输入内容读回后包含 `????`。
- 页面提示存在不合规链接，且不是 `其中0条不合规`。
- 找不到可见的 `开始批量复制` 按钮。
- 已点击过 `开始批量复制`，但还没点击 `查看复制记录` 查日志。
- 无法确认当前页面是 `ali_multiStore` 或 `ali_batchLog`。

## 最短执行路径（优先读这里）

给其它 agent 使用时，优先按这 10 步执行，不要自由发挥：

1. 确认已连接用户登录过的 Chrome；未登录就让用户先扫码登录。
2. 打开主入口 URL：`https://item.jnesoft.com/`。
3. 鼠标悬浮顶部/左侧菜单 **复制上货**，点击二级菜单 **多店复制**。
4. 确认进入 `ali_multiStore` 页面：URL 包含 `item.jnesoft.com/ali_view/ali_multiStore`，或页面标题/正文包含 `淘宝张飞搬家-多店复制`、`商品分配方式`。
5. 找 `.ProseMirror` 或 `[contenteditable="true"]`，用 `document.execCommand('insertText', false, data)` 写入商品数据。
6. 选择 `随机平均分配`。
7. 点击 `全选`，确认页面出现 `全选：已选 N 个店铺`。
8. 提交前校验：行数正确、中文完整、没有 `????`、页面显示 `其中0条不合规`。
9. 只点击一次 `开始批量复制`。这是最终提交按钮。
10. 提交后必须点击 `查看复制记录`，进入 `ali_batchLog` 后确认新增批次并汇总 `复制成功`、`复制中`、`复制失败`、`跳过复制`。

如果当前已经在复制日志页，下一批不要重新找菜单，先对 `ali_batchLog` 执行 `history.back()`，等 `ali_multiStore` 页面或 iframe 回来后再填下一批。

## 失败恢复速查表

| 问题 | 固定处理方式 |
|------|--------------|
| 找不到【多店复制】按钮 | 回到 `https://item.jnesoft.com/`，先 hover `复制上货`，只点精确文本 `多店复制` |
| 只看到 1688 AI 对话，没有表单 | 说明走回旧入口了；重新打开 `https://item.jnesoft.com/`，从 `复制上货` 菜单进入 |
| 找到 `1688复制` / `一键复制` | 不要点；目标必须是 `多店复制` |
| iframe 只能看到 `light-app.1688.com` | 这是旧 1688 工作台壳；优先回到 `https://item.jnesoft.com/` |
| 中文变成 `????` | 停止提交，重新用页面上下文 `execCommand('insertText')` 写入 UTF-8 字符串 |
| `开始批量复制` 点后页面不跳 | 不要再点，立即点击 `查看复制记录` 查批次 |
| 批次筛选查不到 | 用本批任意一个 `上家ID` 搜索；筛选框可能没触发框架更新 |
| 连续第二批找不到输入框 | 当前可能还在 `ali_batchLog`，先 `history.back()` 回 `ali_multiStore` |

## 触发条件

用户说以下关键词时触发：
- "1688分销铺货"、"1688铺货"、"分销铺货"
- "帮我铺货"、"开始铺货"
- 从选品结果（my-title）获取后需要执行铺货

## 前置条件

1. **浏览器可用** — 需要 `browser` toolset 已启用
2. **张飞搬家 / 1688 账号登录** — **优先通过 CDP 连接用户本地已登录的 Chrome**（见下方"登录方案"）
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
4. **附加标签页**：打开 `https://item.jnesoft.com/` → 点击扩展图标 → 徽章显示橙色 **ON**
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

5. 打开 `https://item.jnesoft.com/` → 应该已自动登录

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
https://item.jnesoft.com/
```

## 给弱模型的硬性执行规则

这个 skill 的页面定位不要依赖“看起来像按钮”的视觉判断。默认按下面规则执行：

1. **默认从 `https://item.jnesoft.com/` 进入**。不要先打开 1688 工作台或 AI 助手页面。
2. **不要凭截图猜按钮**。优先用 DOM 文本、URL、iframe 地址判断位置。
3. **不要重复点击 `开始批量复制`**。它是最终提交动作，只允许点一次。
4. **不要用 PowerShell 管道传中文**。中文标题必须通过 UTF-8 安全通道写入页面上下文。
5. **每一步都读页面文本确认**。没确认到目标文本，就不要进入下一步。

### 主入口 URL（优先使用）

登录后直接打开这个 URL：

```
https://item.jnesoft.com/
```

然后按固定菜单路径进入：

1. 悬浮 **复制上货**
2. 点击二级菜单 **多店复制**
3. 等待目标页面出现

```
https://item.jnesoft.com/ali_view/ali_multiStore...
```

如果菜单点击失败，但用户已登录，也可以把下面地址作为兜底直达入口；直达失败时再回到首页菜单，不要猜其它 1688 路由：

```
https://item.jnesoft.com/ali_view/ali_multiStore
```

目标页面可能是顶层 page，也可能在旧 1688 壳里作为 iframe 出现。只要 URL 包含 `item.jnesoft.com/ali_view/ali_multiStore`，并且正文包含 `商品分配方式`、`随机平均分配`、`开始批量复制`，就可以操作表单。

### 页面状态判定表

| 当前状态 | 判断文本 / URL | 下一步 |
|---------|----------------|--------|
| 未登录 | `短信登录/密码登录/扫码登录`、`请登录` | 让用户登录 |
| 张飞搬家首页 | URL 为 `item.jnesoft.com`，页面有 `复制上货` | hover `复制上货`，点击 `多店复制` |
| 多店复制表单 | URL 含 `ali_multiStore`，title/正文含 `淘宝张飞搬家-多店复制` 或 `商品分配方式` | 填表 |
| 复制日志 | URL 含 `ali_batchLog`，title/正文含 `复制日志` | 统计结果；下一批先 `history.back()` 回表单 |
| 1688 AI 对话页 | URL 含 `air.1688.com` 或 `multi-agent-common` 且 body 只有 AI 问答 | 回到 `https://item.jnesoft.com/` |

### 禁止行为

- 不要用 `textContent.includes('复制')` 点击第一个匹配项，页面里有 `1688复制`、`一键复制`、`多店复制`、`复制日志` 等多个相似入口。
- 不要点击隐藏按钮。按钮 `getBoundingClientRect()` 的 `width` 或 `height` 为 0 时不可操作。
- 不要使用旧流程里的 `提交复制`。真实页面没有稳定的二次确认，`开始批量复制` 已经会提交任务。
- 不要根据“按钮仍然可点”判断提交失败。必须去复制日志查批次。
- 不要在点击 `开始批量复制` 后结束任务。下一步固定是点击 `查看复制记录`，并用日志确认批次。
- 不要在 `ali_batchLog` 页面填商品数据。连续提交下一批前必须先回到 `ali_multiStore` 页面或 iframe。

### 页面操作原语

弱模型必须优先使用这些原语，避免自由写选择器：

```javascript
function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function hasExactText(el, text) {
  return (el.innerText || '')
    .split(/\s+/)
    .some(part => part.trim() === text);
}

function findExactText(text, selectors = 'a,button,li,span,div,label') {
  return Array.from(document.querySelectorAll(selectors))
    .find(el => visible(el) && hasExactText(el, text));
}

function hoverExact(text) {
  const el = findExactText(text);
  if (!el) return { ok: false, reason: `${text} not found` };
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
  return { ok: true };
}

function clickExact(text, selectors = 'button,a,li,span,div,label') {
  const el = findExactText(text, selectors);
  if (!el) return { ok: false, reason: `${text} not found` };
  el.click();
  return { ok: true };
}
```

使用规则：

- 进入页面时用 `hoverExact('复制上货')`，再用 `clickExact('多店复制')`。
- 选择分配方式时只点 `随机平均分配`。
- 提交时只点可见 button 且完整文本为 `开始批量复制`。
- 提交后只点可见 button 且完整文本为 `查看复制记录`。
- 如果函数返回 `ok: false`，不要猜坐标，先读页面正文和 URL 判断状态。

## 输入处理固定规则

铺货前先把用户输入规范化，不要边填边解析：

1. 按行拆分，去掉空行和首尾空格。
2. 每行必须是 `https://detail.1688.com/offer/<id>.html` 或 `https://detail.1688.com/offer/<id>.html$$标题`。
3. 提取每行的商品 ID，作为后续日志搜索依据。
4. 如果一批超过 20 条，自动拆成多批，每批最多 20 条，按原顺序连续执行。
5. `expectedKeyword` 从第一条标题里取稳定中文词；没有标题时取用户给的品类词。
6. 填入页面的数据必须仍保持 `URL$$标题` 的原始格式，每条一行。

执行前记录：

```text
本批条数: N
本批商品ID: id1,id2,...
expectedKeyword: xxx
batchHash: sha256(items.join('\n') + '|random-average')
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

### Step 1: 打开张飞搬家主入口

优先直接打开：

```python
browser_navigate(
    url="https://item.jnesoft.com/"
)
```

等待页面完全加载，并确认看到 `复制上货` 菜单。若出现登录页，先让用户完成登录。

### Step 2: 从菜单进入多店复制

1. 鼠标悬浮 **复制上货**
2. 在展开的二级菜单里点击精确文本 **多店复制**
3. 不要点击 `1688复制`、`一键复制`、`复制日志`
4. 等待目标页面：

```
url contains: item.jnesoft.com/ali_view/ali_multiStore
title contains: 淘宝张飞搬家-多店复制
```

### Step 3: 定位多店复制表单

目标表单可能是顶层页面，也可能在旧 1688 工作台的跨域 iframe 中。必须找到：

```
page or iframe url contains: item.jnesoft.com/ali_view/ali_multiStore
title/body contains: 淘宝张飞搬家-多店复制 / 商品分配方式 / 随机平均分配
```

如果它在 iframe 中，弱模型不要尝试通过父页面 `document.querySelector('iframe').contentDocument` 访问它，这会因为跨域失败。应使用当前工具提供的 iframe target / frame 句柄，或直接连接该 iframe 的 CDP target。

### Step 4: 填入铺货内容

1. 找到文本输入框（真实页面通常是 `.ProseMirror` / `contenteditable=true`，不一定是 `textarea`）
2. 将需要铺货的内容粘贴进去，**每条一行**
3. 内容格式示例：

```
https://detail.1688.com/offer/xxx.html
https://detail.1688.com/offer/yyy.html
https://detail.1688.com/offer/zzz.html
```

也支持自定义标题格式（推荐）：

```
https://detail.1688.com/offer/xxx.html$$新标题
```

#### 输入安全校验（必须）

填入后必须从页面重新读取编辑器内容并校验：

- 行数等于输入商品数
- 至少包含一个预期中文词（例如输入标题中的核心词）
- 不包含连续问号乱码，例如 `????`
- 页面提示 `一共提交 N 条链接，其中0条不合规`

> Windows / PowerShell 管道传中文可能把标题变成 `????`。不要用 shell 管道向 Node 传中文后再 `Input.insertText`。优先在 UTF-8 安全通道中用页面上下文执行 `document.execCommand('insertText', false, data)`，并在提交前读取页面文本确认中文完整。

### Step 5: 设置商品分配方式和店铺

1. 在 **商品分配方式** 区域选择第二个选项：**随机平均分配**
2. 在店铺列表区域点击 **【全选】**，把所有店铺都选上
3. 确认所有目标店铺均已处于选中状态

### Step 6: 提交前强校验

点击前必须确认：

- `随机平均分配` 处于选中状态
- `全选` 处于选中状态，并显示 `已选 N 个店铺`
- `开始批量复制` 按钮可点击
- 页面仍显示 `其中0条不合规`
- 本批输入的 `batchHash` 最近没有提交过

推荐生成本批防重复 key：

```
batchHash = sha256(items.join('\n') + '|' + selectedShopNames.join(',') + '|random-average')
```

如果本地缓存里已有相同 `batchHash` 且时间很近，必须先提示用户确认，不能自动重复点击。

### Step 7: 点击正文的【开始批量复制】（最终提交动作）

真实页面验证结果：**【开始批量复制】就是最终提交按钮**。点击后页面可能不跳转、按钮也可能仍然可点，但后台已经生成复制任务并扣减剩余复制数量。

执行规则：

1. 只点击一次 **【开始批量复制】**
2. 点击后立即把本批 `batchHash` 写入本地缓存或当前执行记录
3. 不要因为页面没有跳转而再次点击
4. 等待 3-10 秒后点击页面顶部 **【查看复制记录】**
5. 必须进入复制日志页核验结果；不能只报告“已点击开始批量复制”

> 2026-05-28 真实测试发现：点击后未跳转确认页，但店铺剩余复制数量减少，复制日志新增批次。重复点击会重复提交同一批商品。

### Step 8: 打开【查看复制记录】并核验批次

点击页面顶部 **【查看复制记录】**，进入复制日志页，记录最新批次号和状态。若点击后没有跳转，先等待 3 秒再检查 `ali_batchLog`；仍未进入时，再点击一次 `查看复制记录`，但不要再点击 `开始批量复制`。

核验内容：

- 新增批次号，例如 `20260528_26584`
- 批次类型包含 `多店复制`
- 商品标题是本次输入的标题，而不是乱码
- 状态分布：`复制中`、`复制成功`、`跳过复制`、`复制失败`
- `跳过复制` / `复制失败` 的原因，例如 `商品已复制过`

向用户报告时按批次汇总，不只报告“已点击提交”。

### Step 9: 多次铺货重复

如果有更多商品需要铺货，从 **Step 2** 开始重复。

## 最小可执行 CDP 方案（推荐给能力较弱的 agent）

当可以连接 Chrome DevTools Protocol 时，不要走截图定位，直接用下面的固定逻辑。

### 0. 固定 helper

```javascript
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTarget(CDP, predicate, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const targets = await CDP.List({ host: '127.0.0.1', port: 9222 });
    const target = targets.find(predicate);
    if (target) return target;
    await sleep(1000);
  }
  throw new Error('等待目标页面超时');
}
```

### 1. 打开主入口并进入多店复制

```javascript
let homeTarget = (await CDP.List({ host: '127.0.0.1', port: 9222 }))
  .find(t => t.type === 'page' && t.url.includes('item.jnesoft.com'));
homeTarget ||= (await CDP.List({ host: '127.0.0.1', port: 9222 }))
  .find(t => t.type === 'page');
if (!homeTarget) throw new Error('未找到可用 Chrome 页面');

const homeClient = await CDP({ target: homeTarget, host: '127.0.0.1', port: 9222 });
const { Page: HomePage, Runtime: HomeRuntime } = homeClient;
await HomePage.enable();
await HomeRuntime.enable();
await Promise.all([
  HomePage.loadEventFired(),
  HomePage.navigate({ url: 'https://item.jnesoft.com/' })
]);

await waitForTarget(CDP, t =>
  t.type === 'page' &&
  t.url.includes('item.jnesoft.com')
);

await HomeRuntime.evaluate({
  returnByValue: true,
  awaitPromise: true,
  expression: `(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hasLine = (el, text) => (el.innerText || '')
      .split(/\\s+/)
      .some(line => line.trim() === text);
    const menu = Array.from(document.querySelectorAll('*'))
      .find(el => visible(el) && hasLine(el, '复制上货'));
    if (!menu) return JSON.stringify({ ok: false, reason: 'menu not found' });
    menu.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
    menu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
    return JSON.stringify({ ok: true });
  })()`
});

await sleep(800);

await HomeRuntime.evaluate({
  returnByValue: true,
  awaitPromise: true,
  expression: `(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hasLine = (el, text) => (el.innerText || '')
      .split(/\\s+/)
      .some(line => line.trim() === text);
    const entry = Array.from(document.querySelectorAll('a,button,li,span,div'))
      .find(el => visible(el) && hasLine(el, '多店复制'));
    if (!entry) return JSON.stringify({ ok: false, reason: 'entry not found' });
    entry.click();
    return JSON.stringify({ ok: true });
  })()`
});
```

### 2. 找到多店复制 page / iframe

```javascript
const multiTarget = await waitForTarget(CDP, t =>
  (t.type === 'page' || t.type === 'iframe') &&
  t.url.includes('item.jnesoft.com/ali_view/ali_multiStore')
);
```

### 3. 填入数据、选择随机平均分配、全选店铺

```javascript
const client = await CDP({ target: multiTarget, host: '127.0.0.1', port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const data = items.join('\n'); // items 必须是 UTF-8 字符串数组，不要从 PowerShell 管道读取中文

await Runtime.evaluate({
  returnByValue: true,
  awaitPromise: true,
  expression: `(() => {
    const data = ${JSON.stringify(data)};
    const editor = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    if (!editor) return JSON.stringify({ ok: false, reason: 'editor not found' });

    editor.focus();
    document.execCommand('selectAll', false, null);
    const execOk = document.execCommand('insertText', false, data);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data }));

    const randomAvg = Array.from(document.querySelectorAll('label.el-radio'))
      .find(l => (l.innerText || '').includes('随机平均分配'));
    if (randomAvg && !String(randomAvg.className).includes('is-checked')) randomAvg.click();

    const selectAll = Array.from(document.querySelectorAll('label.el-checkbox'))
      .find(l => (l.innerText || '').includes('全选'));
    if (selectAll && !String(selectAll.className).includes('is-checked')) selectAll.click();

    return JSON.stringify({ ok: true, execOk });
  })()`
});
```

如果需要点击按钮，不要用“第一个包含某词的元素”。使用可见按钮 helper：

```javascript
function clickVisibleButton(text) {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find(b => {
    const rect = b.getBoundingClientRect();
    return (b.innerText || '').trim() === text &&
      rect.width > 0 &&
      rect.height > 0 &&
      !b.disabled;
  });
  if (!btn) return false;
  btn.click();
  return true;
}
```

### 4. 提交前校验

```javascript
const expectedCount = items.length;
const expectedKeyword = '手编男士红绳'; // 用本批标题里的稳定中文词替换

const checkRaw = await Runtime.evaluate({
  returnByValue: true,
  awaitPromise: true,
  expression: `(() => {
    const editorText = document.querySelector('.ProseMirror')?.innerText || '';
    const body = document.body.innerText;
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.innerText || '').trim() === '开始批量复制');

    return JSON.stringify({
      lineCount: editorText.split(String.fromCharCode(10)).filter(Boolean).length,
      hasChinese: editorText.includes(${JSON.stringify(expectedKeyword)}),
      hasQuestion: editorText.includes('????'),
      validZero: body.includes('一共提交${expectedCount}条链接，其中0条不合规'),
      randomAverage: Array.from(document.querySelectorAll('label.el-radio'))
        .some(l => (l.innerText || '').includes('随机平均分配') && String(l.className).includes('is-checked')),
      selectedStoresText: (body.match(/全选：已选 \\d+ 个店铺/) || [''])[0],
      buttonExists: Boolean(btn),
      buttonDisabled: btn?.disabled === true
    });
  })()`
});

const check = JSON.parse(checkRaw.result.value);
if (
  check.lineCount !== expectedCount ||
  !check.hasChinese ||
  check.hasQuestion ||
  !check.validZero ||
  !check.randomAverage ||
  !check.selectedStoresText ||
  !check.buttonExists ||
  check.buttonDisabled
) {
  throw new Error('提交前校验失败：' + JSON.stringify(check));
}
```

### 5. 只提交一次

```javascript
await Runtime.evaluate({
  returnByValue: true,
  expression: `(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.innerText || '').trim() === '开始批量复制');
    btn.click();
    return 'clicked-once';
  })()`
});
```

提交后不要再点 `开始批量复制`。下一步固定是点击 `查看复制记录`。

### 6. 点击查看复制记录并打开复制日志

如果仍在 `ali_multiStore` 页面或 iframe：

```javascript
await sleep(3000);

await Runtime.evaluate({
  returnByValue: true,
  expression: `(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.innerText || '').trim() === '查看复制记录');
    if (!btn) return 'record-button-not-found';
    btn.click();
    return 'record-clicked';
  })()`
});
```

点击 `查看复制记录` 后重新查找日志页面：

```javascript
const logTarget = (await CDP.List({ host: '127.0.0.1', port: 9222 }))
  .find(t => (t.type === 'page' || t.type === 'iframe') && t.url.includes('item.jnesoft.com/ali_view/ali_batchLog'));
if (!logTarget) throw new Error('未找到复制日志页面');
```

更稳的写法：

```javascript
const logTarget = await waitForTarget(CDP, t =>
  (t.type === 'page' || t.type === 'iframe') &&
  t.url.includes('item.jnesoft.com/ali_view/ali_batchLog')
);
```

### 7. 连续多批提交

连续提交第二批时，不要从菜单重新找按钮：

1. 如果当前在 `ali_batchLog` 页面或 iframe，执行 `history.back()`
2. 等待 `ali_multiStore` 页面或 iframe 重新出现
3. 重复“填入数据 → 校验 → 只提交一次 → 复制日志核验”

```javascript
await Runtime.evaluate({ expression: 'history.back()', returnByValue: true });
```

### 8. 复制日志统计

复制日志默认只显示 10 条/页。一批可能被拆成两个店铺批次，例如：

- `20260528_27627`：店铺 `starsnsun`
- `20260528_27628`：店铺 `sunnstars`

弱模型统计时不要只看第一页的前 10 条。更稳的做法：

1. 用一个本批商品 ID 搜索，确认新批次号
2. 再用批次名称筛选每个批次
3. 分别统计 `复制成功`、`复制中`、`复制失败`、`跳过复制`
4. 报告失败原因，例如 `商品规则校验出错` 或 `商品已复制过`

如果批次筛选返回 0 条，可能是输入框没触发框架更新。改用单个 `上家ID` 搜索确认，不要直接断言失败。

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

## 旧 1688 工作台跨域 iframe 兜底方案（2026-05-21 验证通过）

### 问题

如果不得不从 1688 分销工作台进入，【多店复制】功能页面会被**跨域 iframe** 嵌入。默认不要走这条路线，只有 `https://item.jnesoft.com/` 主入口不可用时才使用。

```
父页面: air.1688.com (分销工作台)
  └─ iframe: light-app.1688.com (代小发 ERP，2460×1118)
       └─ 实际功能页面（输入框、按钮都在这里）
```

**无法**通过父页面的 `Runtime.evaluate` 访问 iframe 内部 DOM（跨域限制）。
`document.querySelectorAll('iframe')[0].contentDocument` 返回 null 或报错。

### 兜底方案：Input.dispatchMouseEvent + 精确坐标点击

Chrome DevTools Protocol 的 `Input.dispatchMouseEvent` 在**浏览器级别**分发鼠标事件，
可以穿透 iframe 边界，直接命中 iframe 内的元素！

> 优先使用上面的“最小可执行 CDP 方案”，直接连接 `ali_multiStore` page/iframe target 后用 DOM 文本和选择器操作。只有当前工具无法直接操作该 target 时，才使用坐标点击兜底。

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
| 正文开始批量复制（最终提交） | 蓝色主按钮 | [50.3%, 62.4%] | (1288, 779) |
| 查看复制记录 | 页面顶部按钮 | 需实时截图确认 | 需实时截图确认 |

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

- `item.jnesoft.com` 的【复制上货】是 **hover 展开二级菜单**，不是 click
- `browser_click` 可能无法触发 hover 效果
- **备用方案**：用 `browser_console` 执行 JS 的 `mouseenter` 事件

### 5. 页面加载等待
- 张飞搬家后台是 SPA（单页应用），路由切换后需等待 DOM 更新
- 旧 1688 工作台入口也是 SPA + iframe 组合，只作为兜底路径
- 每步操作后建议用 `browser_snapshot` 确认元素已加载
- 必要时加 `browser_scroll` 确保目标元素在可视区域

### 6. 文本框定位与中文输入
- 多店复制页面的输入框真实为 ProseMirror 富文本编辑器：`.ProseMirror[contenteditable="true"]`
- 优先用页面上下文的 `document.execCommand('insertText', false, data)` 填入中文内容
- 不要用 PowerShell heredoc / 管道把中文传给 Node 后再输入，可能变成 `????`
- 填完后必须读取 `.ProseMirror.innerText` 和页面正文，确认中文完整且没有 `????`
- 如果 `browser_type` 不生效，用 `browser_console` 直接插入文本：

```javascript
const editor = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
if (editor) {
  const data = 'https://detail.1688.com/offer/xxx.html$$中文标题';
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, data);
  editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data}));
  'done';
}
```

### 7. 提交按钮无反馈与重复提交
- **【开始批量复制】是最终提交动作**，不是进入确认页
- 点击后页面可能不跳转，按钮也可能仍可点击，但后台已经提交任务
- 判断提交成功的可靠信号：
  - 店铺剩余复制数量减少
  - 【查看复制记录】出现新批次
  - 新批次的创建时间接近当前时间，复制类型为 `多店复制`
- 点击一次后不要再次点击同一个按钮；应立即切换到复制日志确认
- 若需要重试，必须先比较本批 `batchHash`、店铺和批次日志，确认上一批没有创建

### 8. 批量操作限制
- 一次铺货数量可能有上限（通常 20-50 条）
- 超过上限需分批执行
- 注意观察页面的数量提示

### 9. 错误处理
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
1. browser_navigate → 打开 `https://item.jnesoft.com/`
2. 检查登录状态 → 未登录则引导登录
3. hover 【复制上货】→ click 二级菜单【多店复制】
4. 找到 `ali_multiStore` page/iframe target
5. 填入两条链接 → 每条一行，并校验中文完整、行数正确、0条不合规
6. 选择商品分配方式第二项【随机平均分配】
7. click 【全选】→ 选中所有店铺
8. 生成 batchHash，确认最近没有提交过同一批
9. click 正文【开始批量复制】→ 最终提交，只点击一次
10. 打开【查看复制记录】→ 记录新批次与复制状态
11. 报告结果: 成功/复制中/跳过/失败数量与原因
```
