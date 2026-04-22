# Task 7: CLI/MCP 接口兼容性验证 -  learnings

## 测试结果汇总

| 场景 | 状态 | 说明 |
|------|------|------|
| CLI 默认模式 | ✅ 通过 | exit 0, 输出正常，触发图片搜索 |
| CLI --length | ✅ 通过 | maxLength 正确传递到 run() |
| CLI --count | ⚠️ 未实现 | 参数定义但未传递给 run() |
| CLI --peer-titles | ✅ 通过 | 跳过图片搜索，使用手动标题 |
| MCP server | ✅ 通过 | stdio 正常，run() 签名兼容 |
| 缓存机制 | ✅ 通过 | 第二次运行命中缓存 |
| silent 模式 | ✅ 通过 | --json 抑制日志输出 |

## 发现的问题

### 1. --count 参数未传递 (低优先级)
- **位置**: `bin/cli.js:51-55`
- **现象**: CLI 定义了 `--count` 选项，但调用 `run()` 时未传递 `limit` 参数
- **影响**: 用户期望限制输出数量，但实际不会截断
- **代码**:
```javascript
const result = await run(keywords, {
  maxLength: parseInt(options.length),
  peerTitles,
  silent: jsonMode
  // count/limit 未传递!
});
```
- **参考**: `src/index.js:62` 显示 run() 支持 `limit` 参数

## 验证方法
- 使用实际关键词运行命令
- 检查 exit code 和输出内容
- 使用 `--json` 模式验证结构化输出
- 缓存验证：检查 `.cache/` 目录文件变化

## 注意事项
- MCP server 使用 `silent: true` 静默模式
- 缓存 TTL = 30 分钟
- 缓存 key = `md5(keyword::maxLength::limit)`
