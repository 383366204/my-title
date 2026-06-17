#!/usr/bin/env bash
set -euo pipefail

echo "Taobao Desktop setup check"
echo "==========================="

detect_os() {
  if grep -qi "microsoft" /proc/version 2>/dev/null; then
    echo "wsl"
  elif [[ "${OSTYPE:-}" == darwin* ]]; then
    echo "macos"
  elif [[ "${OS:-}" == Windows_NT ]]; then
    echo "windows"
  else
    echo "linux"
  fi
}

find_taobao_native() {
  if command -v taobao-native >/dev/null 2>&1; then
    command -v taobao-native
    return 0
  fi

  case "$1" in
    macos)
      for path in \
        "$HOME/Library/Application Support/taobao/cli/bin/taobao-native" \
        "$HOME/Library/Application Support/taobao/cli/taobao-runner"; do
        if [ -x "$path" ]; then
          echo "$path"
          return 0
        fi
      done
      ;;
    wsl)
      for path in \
        "/mnt/c/Users/$USER/AppData/Local/Programs/taobao/bin/taobao-native.cmd" \
        "/mnt/c/Users/$USER/AppData/Roaming/taobao/cli/taobao-native"; do
        if [ -f "$path" ]; then
          echo "$path"
          return 0
        fi
      done
      ;;
    windows)
      if command -v taobao-native.cmd >/dev/null 2>&1; then
        command -v taobao-native.cmd
        return 0
      fi
      ;;
  esac

  return 1
}

OS_NAME=$(detect_os)
echo "OS: $OS_NAME"

if [ "$OS_NAME" = "macos" ]; then
  if [ -d "/Applications/淘宝桌面版.app" ]; then
    echo "Taobao Desktop app: /Applications/淘宝桌面版.app"
    open -a "/Applications/淘宝桌面版.app" || true
  else
    echo "Taobao Desktop app not found at /Applications/淘宝桌面版.app"
  fi
fi

if CLI_PATH=$(find_taobao_native "$OS_NAME"); then
  echo "taobao-native CLI: $CLI_PATH"
else
  echo "taobao-native CLI not found"
  if [ "$OS_NAME" = "linux" ]; then
    echo "Native Linux is supported only when a taobao-native-compatible CLI is available on PATH."
    echo "Install/provide that CLI or use --peer-titles fallback in title-gen."
  else
    echo "Install or open Taobao Desktop first, then restart the agent shell if PATH was updated."
  fi
  exit 1
fi

echo ""
echo "CLI help check:"
if [ "$OS_NAME" = "wsl" ] && [[ "$CLI_PATH" == /mnt/c/* ]]; then
  WIN_PATH=$(printf '%s' "$CLI_PATH" | sed 's|^/mnt/\([a-z]\)/|\U\1:\\|; s|/|\\|g')
  /mnt/c/Windows/System32/cmd.exe /d /s /c "$WIN_PATH" --help | head -n 20
else
  "$CLI_PATH" --help | head -n 20
fi

echo ""
echo "Setup check complete."
