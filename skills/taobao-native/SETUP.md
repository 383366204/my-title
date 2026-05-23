# taobao-native 配置指南

## 当前状态

✅ taobao-native skill 文档 - 已本地可用 (`./taobao-native/SKILL.md`)
✅ taobao-native CLI - 已安装 (通过淘宝桌面版)
✅ 淘宝桌面版 - 已安装

## 项目结构

```
my-title/
├── skills/
│   ├── taobao-native/          # taobao-native skill 文档（本地可用）
│   │   ├── SKILL.md           # 完整功能文档
│   │   └── references/
│   │       └── install-download.md # 安装参考
│   └── title-gen/
│       └── src/
│           └── search-taobao.js   # 淘宝搜索模块（已配置）
└── ...
```

## 快速开始

淘宝搜索功能**已配置完成**，可以直接使用：

```bash
# 测试淘宝搜索
node bin/cli.js "纯银项链女高级感"

# 或带手动同行标题
node bin/cli.js "纯银项链女高级感" \
  --peer-titles "925纯银项链女锁骨链简约百搭,韩版项链女设计感小众"
```

## taobao-native CLI 路径

CLI 工具已安装在系统中：

- **Windows**: `C:\Users\%USERNAME%\AppData\Local\Programs\taobao\bin\taobao-native.cmd`
- **macOS**: `~/Library/Application Support/taobao/cli/taobao-native`
- **WSL2**: 自动通过 `cmd.exe` 调用 Windows 路径

## taobao-native 功能速查

### 核心工具

| 工具 | 用途 | 示例 |
|------|------|------|
| `launch` | 启动淘宝桌面版 | `taobao-native launch` |
| `search_products` | **搜索商品** | `taobao-native search_products --args '{"keyword":"连衣裙"}'` |
| `navigate` | 导航到页面 | `taobao-native navigate --args '{"page":"cart"}'` |
| `add_to_cart` | 加入购物车 | `taobao-native add_to_cart --args '{"itemId":"xxx","sku":["规格"]}'` |
| `open_chat` | 旺旺聊天 | `taobao-native open_chat --args '{"source":"search","query":"xxx","message":"你好"}'` |

### 完整文档

查看本地文档获取所有 28 个工具的详细说明：

```bash
# 阅读完整文档
cat skills/taobao-native/SKILL.md

# 或查看特定工具帮助
cmd.exe /c "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\taobao\\bin\\taobao-native.cmd --help"
```

## 手动测试 CLI

```bash
# 1. 启动淘宝桌面版
cmd.exe /c "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\taobao\\bin\\taobao-native.cmd launch"

# 2. 搜索商品
cmd.exe /c "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\taobao\\bin\\taobao-native.cmd search_products --args '{\"keyword\":\"佛牌\"}'"

# 3. 查看帮助
cmd.exe /c "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\taobao\\bin\\taobao-native.cmd --help"
```

## 故障排查

### 问题1: "taobao-native 命令未找到"

**解决**: 淘宝桌面版未安装或未启动

```bash
# 检查淘宝桌面版安装位置
cat /mnt/c/Users/38336/AppData/Roaming/taobao/install-location.txt

# 手动启动
cmd.exe /c "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\taobao\\bin\\taobao-native.cmd launch"
```

### 问题2: "应用未运行"

**解决**: 需要先启动淘宝桌面版

```bash
# 项目代码会自动启动，如需手动启动:
cmd.exe /c "taobao-native launch"
```

### 问题3: WSL2 路径问题

**解决**: 项目代码已自动处理路径转换

```javascript
// search-taobao.js 自动转换路径
const winPath = wslPath
  .replace('/mnt/c/', 'C:\\\\')
  .replace(/\//g, '\\\\');
```

## 降级方案

如果淘宝搜索不可用，使用 `--peer-titles` 手动输入同行标题：

```bash
node bin/cli.js "纯银项链女高级感" \
  --peer-titles "标题1,标题2,标题3"

# 或从文件读取
node bin/cli.js "纯银项链女高级感" \
  --peer-titles-file ./peer-titles.txt
```

## 相关文件

| 文件 | 说明 |
|------|------|
| `skills/taobao-native/SKILL.md` | 完整功能文档（本地） |
| `skills/title-gen/src/search-taobao.js` | 淘宝搜索模块实现 |
| `bin/cli.js` | CLI 入口（支持 `--peer-titles`） |
| `skills/taobao-native/setup.sh` | 环境检查脚本 |

## 需要帮助?

1. 查看本地文档：`cat skills/taobao-native/SKILL.md`
2. 测试 CLI：`cmd.exe /c "taobao-native --help"`
3. 检查日志：`ls /mnt/c/Users/38336/AppData/Roaming/taobao/logs/`

---

**注意**: taobao-native CLI 需要淘宝桌面版运行。首次使用时会自动启动。