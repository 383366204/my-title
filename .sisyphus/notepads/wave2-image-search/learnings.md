# Learnings from Task 3: image_search (单商品图像搜索)

- 已实现 imageSearchSingle(imageUrl, productId, options) 的完整逻辑：
  - 验证 imageUrl 是否有效 URL；若无效则快速返回，无需调用 CLI
  - 构建 taobao-native CLI 调用，采用 image_search，并通过 -o 指定临时输出文件
  - 使用 execSync 同步执行，设置合理超时，捕获异常并日志化警告
  - 读取输出 JSON 文件并解析；若文件读取失败，回退尝试从 stdout 解析 JSON 行
  - 处理嵌套结构 categories → products，扁平化得到 peers 的 titles，形成 peerTitles 阵列
  - 提取价格字段，计算 priceRange 的 min/max（若无有效价格则设为 null）
  - hasMatch 当 peerTitles.length > 0 时为 true
  - 使用 try/finally 保证临时文件删除，避免磁盘垃圾
  - 关键路径包含中文注释，便于后续维护

- 返回结构：{ productId, peerTitles: string[], priceRange: { min: number|null, max: number|null }, hasMatch: boolean }

- 需要后续工作：实现 Task 4 的并发限流（withRateLimit）以及 Task 1/2 的全链路集成测试

- 下一步：在 Wave 2 的后续任务中，将 image_search 的结果整合进 k-factor 的工作流，确保对边界数据的健壮性
