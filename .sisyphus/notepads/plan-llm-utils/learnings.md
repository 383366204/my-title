# 计划：llm-utils.js 学习笔记

- 新增 src/llm-utils.js，实现 parseJsonFromLLM(content) 和 retry(fn, maxRetries, delayMs) 两个工具函数。
- parseJsonFromLLM 支持以下场景：直接 JSON 字符串、markdown code block 包裹、文本中嵌入 JSON、以及尾部逗号；返回解析出的对象/数组。均采用正则 + JSON.parse 的方式处理，遵循既定需求，不引入额外依赖。
- retry 实现了简易重试机制：多次尝试执行异步函数，失败时延迟并重试，直到达到最大重试次数。
- 代码风格遵循项目约定：CommonJS、Chinese inline 注释、函数提供中文 JSDoc。
- QA 总结：大多数场景通过。由于 -e 测试中引号转义在不同环境中表现不一致，普通 JSON、Markdown 包裹、以及尾部逗号解析通过；二次重试测试也通过。建议在 CI 中使用更稳定的测试输入避免手动构建的 shell 转义问题。
