# Browser Relay — 通过 Chrome 扩展操控已登录的标签页

## 概述

**不关闭 Chrome、不复制 Profile、不丢失登录状态**，直接操控用户当前正在使用的 Chrome 标签页。

利用 OpenClaw 自带的 **Browser Relay Chrome 扩展** + 自建 Python 中继服务器，桥接 Hermes 的 CDP 浏览器工具和用户的 Chrome。

## 架构

```
Hermes browser_tool
    | (CDP over WS)
Relay Server (Python, port 19876)
    | (WS + chrome.debugger)
OpenClaw Browser Relay Extension
    | (chrome.debugger.attach)
User's Chrome tab (logged in to 1688/Taobao)
```

## 部署步骤

### Step 1: 启动中继服务器

```bash
cd ~/.hermes/browser-relay
python3 -u relay_server.py --port 19876 --token hermes-relay-2026
```

验证: `curl http://127.0.0.1:19876/` → `{"status":"ok"}`

### Step 2-4: 加载扩展 → 配置 Port/Token → 点击图标附加

详见 browser-relay skill SKILL.md。

## 已知问题

### 问题 1: websockets 16.x API 变更

`process_request(connection, request)` 用 `request.path` 获取路径；返回 `Response` 对象。WS handler 改为 `(ws)` 单参数。

详细记录见 browser-relay skill → references/websockets-16x-debugging.md

### 问题 2: 导航后自动重连

扩展内置 300/700/1500ms 三次重试。ON→…→ON 闪烁是正常的。

### 问题 3: 多标签页支持

每个 tab 独立 sessionId/targetId。

### 问题 4 (CRITICAL): WSL 网络绑定坑

**症状**: Options 显示 "reachable" 但徽章始终 !，日志无 [EXT] 记录。

**根因**: 服务器绑定 127.0.0.1 (WSL loopback)，Chrome 在 Windows 侧，两者 127.0.0.1 不同。

```bash
ss -tlnp | grep 19876
# BAD:  127.0.0.1:19876   → fix: serve(host="0.0.0.0", ...)
# GOOD: 0.0.0.0:19876
```

Options 页 "reachable" 只测 HTTP，不代表 WS 通了。必须看日志有 `[EXT] Chrome 扩展已连接`。

完整排查决策树见 browser-relay skill SKILL.md 故障排查章节。
