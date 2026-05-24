# Browser CDP 本地 Chrome 连接 — 调试记录

## 目标

在不关闭用户正在使用的 Chrome 的情况下，启动一个带调试端口的独立 Chrome 实例，继承用户的登录状态（Cookie），供 Hermes 浏览器工具操作。

## 环境

- OS: WSL2 on Windows
- Windows 用户名: `38336`（数字 ID，非常规）
- Chrome: `C:\Program Files\Google\Chrome\Application\chrome.exe` (v148.0.7778.169)
- Chrome User Data: `C:\Users\38336\AppData\Local\Google\Chrome\User Data`
- WSL 路径前缀: `/mnt/c/Users/38336/`

## 尝试过程与结果

### 尝试 1: 直接用 WSL 路径启动 Chrome + --remote-debugging-port=9222
```bash
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 &
```
**结果**: ❌ 进程启动但端口未监听。WSL 直接调用 .exe 不适合带参数的 GUI 程序。

### 尝试 2: cmd.exe /c start 启动
```bash
cmd.exe /c 'start "" "chrome路径" --remote-debugging-port=9222'
```
**结果**: ❌ Chrome 未启动（tasklist 无 chrome 进程）。`cmd.exe /c start` 在后台模式下不可靠。

### 尝试 3: cmd.exe 前台调用（background=true）
**结果**: ❌ 同上，端口不生效。且如果已有 Chrome 运行，新窗口复用旧进程忽略调试参数。

### 尝试 4: PowerShell Start-Process ✅（成功）
```bash
powershell.exe -Command "Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' \
  -ArgumentList '--remote-debugging-port=9222','--user-data-dir=C:\Users\38336\chrome_profile_1688'"
```
**结果**: ✅ Chrome 启动，9222 端口就绪，返回有效 WebSocket URL。

### Profile 复制的关键发现

| 文件 | 能否复制 | 说明 |
|------|---------|------|
| `Local State` | ✅ | 全局偏好设置 |
| `Default/Preferences` | ✅ | 用户配置 |
| `Default/Login Data` | ✅ | 已保存的密码 |
| `Default/Web Data` | ✅ | Web 数据 |
| `Default/Network/Cookies` | ✅ | **网络层 Cookie（最重要）** |
| `Default/History` | ✅ | 浏览历史 |
| `Default/Cookies` | ❌ | SQLite Cookie DB，运行时被原 Chrome 锁定 |
| `Default/Local Storage/leveldb` | ✅ | localStorage 数据（含 token） |
| `Default/Session Storage` | ✅ | sessionStorage |
| `Default/IndexedDB` | ✅ | IndexedDB 数据 |

### 登录状态继承测试结果

复制上述文件后启动新 Chrome → 打开 1688 分销工作台 → **仍弹出登录窗口**。

原因分析：
1. `Default/Cookies` 文件无法复制（被锁定）— 部分网站的主 Cookie 存这里
2. 1688 可能使用了额外的加密存储或 session 机制
3. **解决方案**：在新 Chrome 中手动登录一次，之后该独立 Profile 会保持登录态

## 最终可用流程

```
1. 复制 Profile 关键文件到新目录（首次）
2. PowerShell Start-Process 启动带调试端口的 Chrome
3. curl 验证 9222 端口就绪
4. export BROWSER_CDP_URL="http://localhost:9222"
5. browser_navigate 操作页面
6. 如需登录 → 手动登录一次（之后持久化）
```

## 注意事项

- **Windows 用户名可能是数字 ID**（如 `38336`），不要假设是字母用户名
- `--user-data-dir` 必须用 **Windows 原生路径**（`C:\Users\...`），不能用 WSL 路径（`/mnt/c/...`）
- 每次会话可能需要重新执行 Step 2-4（Chrome 关闭后需重启）
- 如果用户完全关闭了所有 Chrome，可以直接用 `--remote-debugging-port=9222` 启动主实例，无需复制 Profile
