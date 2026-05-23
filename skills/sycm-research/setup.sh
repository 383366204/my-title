#!/usr/bin/env bash
set -euo pipefail

# SYCM Chrome 调试模式设置脚本
# 用于启动 Chrome 远程调试模式，方便后续连接

# 默认端口
DEFAULT_PORT=9222
PORT=${SYCM_PORT:-$DEFAULT_PORT}

# 解析命令行参数
LAUNCH=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --port)
      PORT="$2"
      shift 2
      ;;
    --launch)
      LAUNCH=true
      shift
      ;;
    *)
      echo "用法: $0 [--port <端口>] [--launch]"
      echo "  --port <端口>    指定调试端口 (默认: 9222，也可通过 SYCM_PORT 环境变量设置)"
      echo "  --launch         如果 Chrome 未在调试模式下运行，则启动它"
      exit 1
      ;;
  esac
done

echo "📝 SYCM Chrome 调试助手"
echo "======================"
echo ""

# 检测操作系统
detect_os() {
  if grep -q "microsoft" /proc/version 2>/dev/null; then
    echo "wsl"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macos"
  else
    echo "linux"
  fi
}

OS=$(detect_os)
echo "🔍 检测到操作系统: $OS"

# 查找 Chrome/Edge 可执行文件
find_chrome() {
  case $OS in
    wsl)
      WSL_CHROME_PATHS=(
        "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
        "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
        "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe"
        "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      )
      for path in "${WSL_CHROME_PATHS[@]}"; do
        if [ -f "$path" ]; then
          echo "$path"
          return
        fi
      done
      ;;
    macos)
      MAC_CHROME_PATHS=(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      )
      for path in "${MAC_CHROME_PATHS[@]}"; do
        if [ -f "$path" ]; then
          echo "$path"
          return
        fi
      done
      ;;
    linux)
      LINUX_CHROME_BINS=(
        "google-chrome"
        "google-chrome-stable"
        "chromium-browser"
        "chromium"
        "microsoft-edge"
        "microsoft-edge-stable"
      )
      for bin in "${LINUX_CHROME_BINS[@]}"; do
        if command -v "$bin" >/dev/null 2>&1; then
          echo "$(command -v "$bin")"
          return
        fi
      done
      ;;
  esac
}

CHROME_PATH=$(find_chrome)

# 检查端口是否已被 Chrome 调试模式占用
check_port() {
  if curl -s "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

echo "🔎 检查端口 ${PORT} 状态..."

if check_port; then
  echo "✅ Chrome 调试模式已在运行"
  echo ""
  echo "调试信息:"
  curl -s "http://127.0.0.1:${PORT}/json/version" || true
  echo ""
  echo "下一步操作:"
  echo "  可以使用 Chrome DevTools 协议连接到 http://127.0.0.1:${PORT}"
  exit 0
fi

echo "⚠️  端口 ${PORT} 未被 Chrome 调试模式占用"

if [ "$LAUNCH" = false ]; then
  echo ""
  echo "使用 --launch 参数启动 Chrome 调试模式，例如："
  echo "  $0 --launch"
  echo "  $0 --port 9223 --launch"
  exit 1
fi

# 启动 Chrome 调试模式
if [ -z "$CHROME_PATH" ]; then
  echo "❌ 未找到 Chrome 或 Edge 浏览器"
  echo ""
  case $OS in
    wsl)
      echo "请安装 Chrome 或 Edge 浏览器（Windows 版本）"
      ;;
    macos)
      echo "请从 App Store 或官网安装 Chrome 或 Edge 浏览器"
      ;;
    linux)
      echo "请使用包管理器安装 Chrome 或 Chromium 浏览器"
      ;;
  esac
  exit 1
fi

echo "✅ 找到浏览器: $CHROME_PATH"

# 创建用户数据目录
USER_DATA_DIR=$(mktemp -d -t sycm-chrome-XXXXXXXX)
echo "📂 创建用户数据目录: $USER_DATA_DIR"

echo "🚀 启动 Chrome 调试模式..."
echo ""

# 构建启动命令
case $OS in
  wsl)
    # 将 WSL 路径转换为 Windows 路径
    WIN_USER_DATA_DIR=$(wslpath -w "$USER_DATA_DIR")
    # 使用 cmd.exe 启动 Chrome
    cmd.exe /c start "" "$(wslpath -w "$CHROME_PATH")" --remote-debugging-port="${PORT}" --user-data-dir="${WIN_USER_DATA_DIR}" --no-first-run --disable-first-run-ui 2>/dev/null &
    ;;
  macos|linux)
    # 直接启动 Chrome
    nohup "$CHROME_PATH" --remote-debugging-port="${PORT}" --user-data-dir="${USER_DATA_DIR}" --no-first-run --disable-first-run-ui >/dev/null 2>&1 &
    ;;
esac

# 保存 PID 到临时文件
echo $! > "$USER_DATA_DIR/chrome.pid"

# 等待 Chrome 启动
echo "⏳ 等待 Chrome 启动..."
for i in {1..10}; do
  sleep 2
  if check_port; then
    echo ""
    echo "🎉 Chrome 调试模式启动成功！"
    echo ""
    echo "调试信息:"
    curl -s "http://127.0.0.1:${PORT}/json/version" || true
    echo ""
    echo "下一步操作:"
    echo "  1. 在打开的 Chrome 窗口中访问你需要调试的网站"
    echo "  2. 使用 Chrome DevTools 协议连接到 http://127.0.0.1:${PORT}"
    echo ""
    echo "用户数据目录: $USER_DATA_DIR"
    echo "如需停止 Chrome，删除该目录即可"
    exit 0
  fi
  echo -n "."
done

echo ""
echo "⚠️  可能启动超时，请检查 Chrome 是否正常打开"
echo "用户数据目录: $USER_DATA_DIR"
