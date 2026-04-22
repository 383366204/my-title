# Draft: 手机远程操控 OpenCode - 已完成

## 最终方案：OpenCode Web + Tailscale

### 配置信息
- **Tailscale IP**: 100.110.245.111
- **OpenCode 服务器端口**: 4096
- **用户名**: opencode
- **密码**: mytitle2026
- **访问地址**: http://100.110.245.111:4096

### 使用方式
1. 手机安装 Tailscale → 登录同一账号
2. 浏览器打开 http://100.110.245.111:4096
3. 输入用户名 opencode, 密码 mytitle2026
4. 开始操控 OpenCode

### 日常启动
```bash
# 终端启动（或用 tmux 后台运行）
cd /mnt/d/project/my-title
export OPENCODE_SERVER_PASSWORD="mytitle2026"
nohup opencode serve --hostname 0.0.0.0 --port 4096 > /tmp/opencode-serve.log 2>&1 &
```

### 关键发现
- OpenCode `opencode serve` 内置 Web 界面
- 用户名必须是 `opencode`（源码硬编码）
- 密码通过环境变量 `OPENCODE_SERVER_PASSWORD` 设置
- Tailscale 提供端到端加密的安全隧道

### 已排除方案
- 飞书 Bot: 需要开发量，当前方案零开发已满足需求