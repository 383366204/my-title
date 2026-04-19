# SRC 目录知识库

**路径:** `src/`
**用途:** 核心业务逻辑和 API 集成

---

## 文件结构

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `index.js` | 流程编排器 | `run(input, maxLength)` - 主工作流 |
| `extract-core.js` | AI 提取 | `extractCoreAndModifiers()`, `fallbackExtract()` |
| `search-1688.js` | 1688 搜索与过滤 | `searchAndFilter(coreWord, modifiers)` |
| `search-taobao.js` | 淘宝同行标题搜索 | `searchTaobaoTitles()`, `isTaobaoNativeInstalled()` |
| `generate-title.js` | 标题生成逻辑（GLM AI） | `generateTitles()` |
| `glm-client.js` | GLM API 客户端 | `GLMClient` 类 |
| `alibaba1688-client.js` | 1688 API 客户端 | `Alibaba1688Client` 类 |
| `banned-words.js` | 合规性检查 | `removeBannedWords()` |

### 外部依赖

| 文件 | 位置 | 说明 |
|------|------|------|
| `taobao-native/SKILL.md` | `../taobao-native/` | 淘宝 skill 文档（本地） |
| `taobao-native` CLI | 系统路径 | 淘宝桌面版 CLI 工具 |

---

## 工作流程

```
run(input, options)
  ├─ extractCoreAndModifiers(input)
  │     └─ GLMClient.extractCoreAndModifiers()
  │     └─ fallbackExtract() [API 失败时]
  │
  ├─ parallel(1688搜索 + 淘宝搜索) [Promise.all]
  │     ├─ searchAndFilter(coreWord, modifiers)
  │     │     └─ Alibaba1688Client.search()
  │     │     └─ filterRelevantProducts() [按刚性修饰词过滤]
  │     │
  │     └─ searchTaobaoTitles(coreWord)
  │           └─ taobao-native CLI [或手动输入降级]
  │
  └─ generateTitles(blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength)
        └─ GLMClient.generateTitles() [参考同行标题，标题必须以蓝海词开头]
        └─ removeBannedWords() [合规性检查]
```

---

## 去哪改什么

| 修改内容 | 文件 | 备注 |
|----------|------|------|
| 添加工作流步骤 | `index.js` | 在 extract/search/generate 之间插入 |
| 更换 AI 模型 | `glm-client.js` | 更新默认模型常量 |
| 更换 1688 接口 | `alibaba1688-client.js` | 更新 base URL |
| 修改淘宝搜索 | `search-taobao.js` | taobao-native CLI 集成 |
| 调整标题格式 | `generate-title.js` | 修改 GLM 提示词和生成逻辑 |
| 添加违禁类别 | `banned-words.js` + `data/banned-words.json` | 保持同步 |
| 添加刚性模式 | `extract-core.js` | 添加到 `rigidPattern` 正则 |
| 添加标题生成方法 | `glm-client.js` | 新增 `generateTitles()` 方法 |

---

## 代码规范

### 类模式
```javascript
class ClientName {
  constructor({ apiKey, apiBase }) {
    this.apiKey = apiKey;
    this.apiBase = apiBase || 'default-url';
  }
  
  async methodName() {
    // try/catch + 降级处理
  }
}
module.exports = ClientName;
```

### 函数模式
```javascript
/**
 * 中文描述
 * @param {type} paramName - 参数描述
 * @returns {type} 返回值描述
 */
async function functionName(params) {
  // 使用中文内联注释实现业务逻辑
}
module.exports = { functionName };
```

### 修饰词分类
- **rigid（刚性）**: 材质(纯银)、颜色(黑色)、规格(XL)、人群(女款)
- **optional（可选）**: 风格(ins风)、流行词(高级感)、季节词(2026新款)

---

## 本项目禁忌（ANTI-PATTERNS）

- ❌ 所有模块都没有单元测试
- ❌ `run()` 参数没有输入验证（已更新支持 options.peerTitles）
- ❌ `banned-words.js` 同步读取文件（在 require 时加载）
- ❌ `fallbackExtract()` 中使用硬编码正则模式
- ❌ `generate-title.js` 旧版使用空格分词（已重写为 GLM AI）

---

## 注意事项

- **JSDoc 必需**: 所有导出函数必须有 JSDoc
- **降级策略**: AI API 失败时必须提供手动降级方案
- **标题候选**: 生成 3-5 个变体，去重，最多返回 5 个
- **违禁词**: 启动时从 `../data/banned-words.json` 一次性加载
