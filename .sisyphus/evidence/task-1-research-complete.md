# taobao-native CLI 研究报告

**研究日期:** 2026-04-18
**技能ID:** 5d2b024b-8ffe-4f66-a6df-1626a2e8f0b1
**技能名称:** 淘宝官方skill
**来源:** 虾评Skill平台 (xiaping.coze.site)

---

## 1. CLI搜索命令格式

### 前置要求
- **mcporter**: 必须安装在系统PATH中 (`npm install -g mcporter`)
- **淘宝桌面版**: 必须本地安装并登录
- **适用系统**: Windows, macOS (Apple Silicon + Intel)

### 完整命令格式

```bash
# 列出所有可用工具
mcporter list taobao-native --schema

# 搜索商品（核心命令）
mcporter call taobao-native.search_products --args '{"keyword":"连衣裙"}' --output json

# 其他常用命令
mcporter call taobao-native.navigate --args '{"page":"cart"}' --output json
mcporter call taobao-native.navigate --args '{"page":"order","searchKey":"耳机"}' --output json
mcporter call taobao-native.read_page_content --args '{"scope":"main"}' --output json
mcporter call taobao-native.scan_page_elements --args '{"filter":"购物车"}' --output json
mcporter call taobao-native.add_to_cart --args '{"itemId":"601542707852","sku":["黑色","XL"]}' --output json
mcporter call taobao-native.open_chat --args '{"productName":"连衣裙","message":"请问什么时候发货？", "source": "order"}' --output json
```

### 参数说明

| 命令 | 必填参数 | 可选参数 | 说明 |
|------|---------|---------|------|
| `search_products` | keyword (string) | - | 搜索关键词 |
| `navigate` | page (string) | searchKey | 页面: home/cart/order/message/tmall/... |
| `read_page_content` | - | scope, maxLength, offset | 读取页面文本 |
| `scan_page_elements` | - | filter, scope | 扫描可交互元素 |
| `add_to_cart` | - | itemId, sku | 加入购物车 |

---

## 2. 输出格式（JSON结构）

### search_products 返回格式

**文档描述:** 搜索商品并返回结果列表

**参数:**
- `keyword`: string (必填) - 搜索关键词

**注意:** 当前环境中 taobao-native 服务未配置，无法实测输出格式。根据 SKILL.md 文档，该工具返回商品列表，包含以下字段类型（具体结构需实际测试）:
- 商品ID
- 商品标题
- 价格
- 图片链接
- 店铺信息

### read_page_content 返回格式

```json
{
  "content": "页面可见文本内容",
  "truncated": true/false,
  "remainingLength": 数字,
  "offset": 数字
}
```

**说明:**
- 默认最多返回 5000 字符
- `truncated: true` 且 `remainingLength > 0` 时，可通过 `offset` 分段读取后续内容

### scan_page_elements 返回格式

返回带序号的元素列表，用于 `click_element` 操作:
```json
[
  {"index": 0, "text": "商品标题", "tag": "div"},
  {"index": 1, "text": "删除", "tag": "div"}
]
```

---

## 3. 安装检测方法

### 检测 mcporter

```bash
which mcporter
# 或
where mcporter

# 输出示例: /home/sunwenda/.npm-global/bin/mcporter
# Exit code: 0 表示已安装
```

### 检测 taobao-native 服务

```bash
mcporter list taobao-native --schema

# 已安装: 返回工具列表和schema
# 未安装: "Unknown MCP server 'taobao-native'"
```

### 环境状态（本研究环境）

```
mcporter: ✅ 已安装 (/home/sunwenda/.npm-global/bin/mcporter)
taobao-native: ❌ 未配置 (Unknown MCP server)
淘宝桌面版: ❌ 未安装 (需手动安装)
```

---

## 4. 错误处理行为

### 文档记录的注意事项

1. **页面加载时间**: 导航后页面需加载时间，等待后再读取内容
2. **任务完成后必须关闭页面** (首页除外)
3. **search_products/add_to_cart/open_chat** 已内置完整流程，调用成功后请勿再手动操作

### 可能的错误场景

| 场景 | 预期行为 |
|------|---------|
| 淘宝桌面版未安装 | 服务不可用，命令失败 |
| 未登录淘宝账号 | 操作可能被拒绝或需要重新登录 |
| 网络超时 | CLI 应返回错误信息 |
| 商品不存在 | search_products 返回空列表 |

### 复合工具 (自动处理复杂流程)

- `add_to_cart`: 自动处理 SKU 选择和弹窗
- `open_chat`: 自动完成全流程（打开旺旺、定位商品、发送消息）

---

## 5. 结果数量限制

### search_products 限制

**文档中未明确说明返回数量限制**，推测:
- 默认返回第一页商品列表
- 具体数量取决于淘宝搜索结果（通常每页 20-60 条）

### 控制结果的方式

1. 通过 `keyword` 精确筛选
2. 多次调用获取更多页面（分页）
3. 使用 `scan_page_elements` 的 `filter` 参数过滤

### read_page_content 限制

- 默认最多返回 **5000 字符**
- 通过 `scope` 参数缩小范围
- 通过 `offset` 参数分段读取

---

## 6. 工作流程参考

```
1. navigate — 导航到目标页面（购物车/订单页可传 searchKey 自动筛选）
2. read_page_content — 读取页面可见文本
3. scan_page_elements — 扫描可交互元素
4. click_element 或 input_text — 执行交互
5. close_page — 任务完成后关闭页面
```

### 场景示例：搜索商品

```bash
# 步骤1: 搜索商品
mcporter call taobao-native.search_products --args '{"keyword":"纯银项链女高级感"}' --output json

# 步骤2: 读取页面内容（如果搜索是在页面内进行）
mcporter call taobao-native.read_page_content --args '{"scope":"main"}' --output json

# 步骤3: 扫描元素找到目标商品
mcporter call taobao-native.scan_page_elements --args '{}' --output json

# 步骤4: 点击商品
mcporter call taobao-native.click_element --args '{"index":5}' --output json

# 步骤5: 关闭页面
mcporter call taobao-native.close_page --args '{}' --output json
```

---

## 7. 相关资源链接

- **虾评Skill平台:** https://xiaping.coze.site/skill/5d2b024b-8ffe-4f66-a6df-1626a2e8f0b1
- **SKILL.md (官方文档):** https://tblifecdn.taobao.com/taobaopc/skills/taobao-native/SKILL.md
- **Agent 使用指南:** https://xiaping.coze.site/skill.md

---

## 8. 结论与建议

### taobao-native CLI 特点

1. **基于本地淘宝桌面客户端**: 无需处理登录、验证码或反爬
2. **使用 Chromium 原生输入事件**: 比浏览器自动化更可靠
3. **不打开额外浏览器窗口**: 在用户本地桌面应用中执行

### 与 1688 API 的对比

| 方面 | taobao-native | 1688 API |
|------|--------------|----------|
| 认证方式 | 淘宝桌面已登录 | 需要 API Key |
| 数据格式 | CLI JSON 输出 | REST JSON |
| 可靠性 | 依赖桌面客户端 | 依赖网络/API |
| 可编程性 | 需通过 mcporter 调用 | 直接 HTTP 调用 |

### 对于本项目的意义

- taobao-native 可作为 1688 API 的替代方案
- 需要本地安装淘宝桌面版和配置 mcporter
- **注意:** 当前研究环境未安装淘宝桌面客户端，无法实测 search_products 的完整输出格式