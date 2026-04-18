#!/bin/bash
# taobao-native 配置脚本

echo "📝 淘宝桌面版配置助手"
echo "======================"

# 检查淘宝桌面版安装位置
TAOBAO_PATHS=(
    "/mnt/c/Program Files (x86)/Taobao/taobao.exe"
    "/mnt/c/Program Files/Taobao/taobao.exe"
    "/mnt/c/Users/$USER/AppData/Local/Taobao/taobao.exe"
)

TAOBAO_FOUND=""
for path in "${TAOBAO_PATHS[@]}"; do
    if [ -f "$path" ]; then
        TAOBAO_FOUND="$path"
        break
    fi
done

if [ -z "$TAOBAO_FOUND" ]; then
    echo "❌ 未找到淘宝桌面版"
    echo ""
    echo "请手动安装淘宝桌面版："
    echo "1. 双击运行: C:\Users\%USERNAME%\Downloads\taobao-setup-win-x64-2.5.1.exe"
    echo "2. 按向导完成安装"
    echo "3. 安装完成后重新运行此脚本"
    echo ""
    echo "或者通过命令行安装（可能需要手动确认）:"
    echo "  cd /mnt/c/Users/\$USER/Downloads"
    echo "  ./taobao-setup-win-x64-2.5.1.exe"
    exit 1
fi

echo "✅ 找到淘宝桌面版: $TAOBAO_FOUND"

# 查找 taobao-native CLI
TAOBANATIVE_PATHS=(
    "/mnt/c/Users/$USER/AppData/Roaming/taobao/cli/taobao-native"
    "/mnt/c/ProgramData/taobao/cli/taobao-native"
    "/mnt/c/Program Files (x86)/Taobao/cli/taobao-native"
)

TAOBANATIVE_FOUND=""
for path in "${TAOBANATIVE_PATHS[@]}"; do
    if [ -f "$path" ] || [ -f "$path.cmd" ]; then
        TAOBANATIVE_FOUND="$path"
        break
    fi
done

if [ -z "$TAOBANATIVE_FOUND" ]; then
    echo "⚠️ 未找到 taobao-native CLI"
    echo "尝试启动淘宝桌面版以安装 CLI..."
    
    # 尝试启动淘宝桌面版
    if [ -n "$TAOBAO_FOUND" ]; then
        cmd.exe /c "start $(echo $TAOBAO_FOUND | sed 's|/mnt/c/|C:\\|g' | sed 's|/|\\|g')" 2>/dev/null
        echo "⏳ 请等待淘宝桌面版启动..."
        sleep 5
    fi
    
    # 再次检查
    for path in "${TAOBANATIVE_PATHS[@]}"; do
        if [ -f "$path" ] || [ -f "$path.cmd" ]; then
            TAOBANATIVE_FOUND="$path"
            break
        fi
    done
fi

if [ -n "$TAOBANATIVE_FOUND" ]; then
    echo "✅ 找到 taobao-native CLI: $TAOBANATIVE_FOUND"
else
    echo "⚠️ CLI 未找到，但淘宝桌面版已安装"
    echo "CLI 将在首次启动淘宝桌面版后自动安装"
fi

# 配置 mcporter
echo ""
echo "🔧 配置 mcporter..."

MCPorter_CONFIG="$HOME/.mcporter/mcporter.json"

# 读取当前配置
if [ -f "$MCPorter_CONFIG" ]; then
    CURRENT_CONFIG=$(cat "$MCPorter_CONFIG")
else
    CURRENT_CONFIG='{"mcpServers":{},"imports":[]}'
fi

# 添加 taobao-native 配置（如果尚未存在）
if ! echo "$CURRENT_CONFIG" | grep -q "taobao-native"; then
    # 获取 Windows 格式的路径
    if [ -n "$TAOBANATIVE_FOUND" ]; then
        WIN_PATH=$(echo "$TAOBANATIVE_FOUND" | sed 's|/mnt/c/|C:\\|g' | sed 's|/|\\|g')
        
        # 创建新的配置
        NEW_CONFIG=$(echo "$CURRENT_CONFIG" | jq --arg path "$WIN_PATH" '.mcpServers["taobao-native"] = {
            "command": "cmd.exe",
            "args": ["/c", $path],
            "env": {
                "TAOBAO_DESKTOP_PATH": "'$(echo $TAOBAO_FOUND | sed 's|/mnt/c/|C:\\|g' | sed 's|/|\\|g')'"
            }
        }')
        
        echo "$NEW_CONFIG" > "$MCPorter_CONFIG"
        echo "✅ taobao-native 已添加到 mcporter 配置"
    else
        echo "⚠️ 未找到 CLI 路径，跳过 mcporter 配置"
    fi
else
    echo "✅ taobao-native 已在 mcporter 配置中"
fi

echo ""
echo "🎉 配置完成！"
echo ""
echo "测试命令:"
echo "  mcporter list taobao-native --schema"
echo ""
echo "或直接使用 taobao-native CLI:"
if [ -n "$TAOBANATIVE_FOUND" ]; then
    echo "  $TAOBANATIVE_FOUND --help"
fi