# 样式维护

`../App.css` 是唯一入口，按原单文件顺序导入连续规则段。文件名表达主要内容，不意味着选择器只作用于该业务区域。

| 文件 | 主要内容 |
| --- | --- |
| foundation.css | 字体、变量、基础工具类、React Flow 初始覆盖 |
| node-status.css | 历史条目、节点状态、顶部状态与步骤条 |
| node-workbench.css | 节点操作、结果摘要、种子与商品列表 |
| node-controls.css | 操作按钮、铺货进度与反馈 |
| overlays.css | 通用弹窗、关闭按钮与诊断区域 |
| configuration.css | 原有输入配置区段，未改变业务规则 |
| artifacts.css | 产物预览、诊断明细及原有相邻覆盖 |
| console-base.css | 原控制台布局与共享表单规则 |
| workspace-layout.css | 画布、双侧栏、底部日志布局 |
| theme-overrides.css | 原有后置视觉覆盖，不可提前导入 |
| platform-status.css | 平台状态条 |
| manual-input.css | 原有手动输入及后续追加区段 |
| responsive-workspace.css | 本轮新增的窄屏侧栏和顶部布局修复 |

## 约束

- 不按文件名排序导入，不把后置覆盖直接合并到基础规则；同权重规则依赖加载顺序。
- 修改既有选择器前用 `rg` 检查所有定义。文件拆分不等于完成 CSS 去重，也不是 CSS Modules 隔离。
- 首次纯迁移的构建 CSS 与原文件逐字节相同；之后的窄屏修复单独放在最后一层。
- 新增本地 `url(...)` 时以所在 CSS 文件为路径基准。
- 用 `npm run web:build` 验证构建，再用 `npm run test:workflow-browser` 检查桌面和窄屏。该浏览器测试用本地替身，不操作真实商家平台。
