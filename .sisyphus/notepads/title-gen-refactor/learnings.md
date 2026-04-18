# 变更学习记录 - GLM 客户端新增 generateTitles 方法

日期: 2026-04-18

- 目标: 在 GLM 客户端（src/glm-client.js）新增 generateTitles({ coreWord, modifiers, peerTitles, products, maxLength }) 方法，调用 GLM API 生成 3-5 条 SEO 标题，保留现有 extractCoreAndModifiers 不变。
- 实现要点:
  - 新增 async generateTitles 方法，参数结构严格遵循需求。
  - 提示词设计：角色为电商标题生成专家，任务为参考同行标题生成 3-5 条标题，输出 JSON 格式。
  - 输入包含 coreWord、modifiers、peerTitles、maxLength，若 peerTitles 为空则执行降级生成。
  - temperature 设置 0.7，timeout 20000ms。
  - 降级逻辑：若返回异常或标题数组为空，返回空数组以保持流程安全。代码中尽量避免抛错，提升鲁棒性。
  - 语法检查：通过 node -c 检查语法，且通过一个简单 require 调用验证方法存在性。
- 结果: 变更已在 src/glm-client.js 完成并通过静态检查。未修改 extractCoreAndModifiers。下一步可在工作流中接入新方法以替代或辅助当前标题生成功能。

注意: 本记录仅用于团队内部追踪，后续如需在流水线中应用，请同步更新相关调用点（例如在 generate-title.js 中接入 GLM 调用）。
