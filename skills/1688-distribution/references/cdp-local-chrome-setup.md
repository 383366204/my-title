# CDP 连接本地 Chrome — 完整指南

## 为什么需要 CDP

Hermes 内置浏览器（Browserbase/Camofox）是独立实例，不共享用户本地浏览器的 Cookie 和登录状态。
对于需要登录态的操作（如 1688 铺货、淘宝操作等），通过 CDP 连接用户本地已登录的 Chrome 是最佳方案。

## CDP 工作原理

```
用户本地 Chrome (--remote-debugging-port=9222)
    ↕ WebSocket (CDP)
Hermes browser tools (browser_navigate, click, type, ...)
    ↕ 操作
目标网站（共享用户的 Cookie/登录态）
```

## 设置步骤

### Step 1: 完全关闭 Chrome

**必须完全关闭**，否则调试端口参数不生效：

```bash
# Windows: 任务管理器结束所有 chrome.exe 进程
# 或命令行:
taskkill /F /IM chrome.exe
```

> 常见错误：只关了窗口但后台进程还在 → 新 Chrome 启动时复用旧进程 → 端口参数被忽略

### Step 2: 以调试模式启动 Chrome

```bash
# WSL 中启动 Windows Chrome
/mnt/c/Windows/System32/cmd.exe /c 'start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222'
```

其他常见 Chrome 路径：
- `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
- Edge: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --remote-debugging-port=9222`

### Step 3: 验证端口就绪

```bash
curl -s http://localhost:9222/json/version
```

预期返回类似：
```json
{
  "Browser": "Chrome/xxx",
  "WebSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/xxx-xxx"
}
```

如果超时或无响应：Chrome 可能没有正确以调试模式启动，回到 Step 1 重试。

### Step 4: 配置 Hermes 使用 CDP

两种方式（任选一种）：

**方式 A：环境变量（临时，当前会话）**
```bash
export BROWSER_CDP_URL=http://localhost:9222
```

**方式 B：config.yaml（持久）**
```yaml
browser:
  cdp_url: http://localhost:9222
```

**方式 C：Hermes CLI 命令（推荐）**
```bash
hermes browser connect http://localhost:9222
```

配置后，所有 `browser_navigate`、`browser_click` 等工具自动使用本地 Chrome。

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| curl 9222 无响应 | Chrome 未以调试模式启动 | 完全关闭 Chrome 后重启 |
| curl 返回空 | 端口被占用但非调试模式 | 换端口如 9333 |
| 连接后页面未登录 | 用户未在本地 Chrome 登录过该网站 | 先手动登录一次 |
| 操作后页面无变化 | 可能连接到了错误的 tab | 用 browser_snapshot 确认当前页面 |
| Chrome 启动后立即关闭 | 已有 Chrome 实例在运行 | 任务管理器结束所有 chrome.exe |

## 注意事项

- **安全**：CDP 连接后 Hermes 可以操作你浏览器中的任何标签页和网站，仅在你信任的环境中使用
- **性能**：操作的是真实浏览器（非 headless），速度比内置云浏览器慢但更真实
- **稳定性**：用户手动关闭 Chrome 会断开连接，需要重新启动和连接
- **多用户**：每个 Chrome 实例只能一个 CDP 连接
