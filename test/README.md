# 测试目录

项目测试统一放在本目录，生产代码目录不再混放测试文件。

| 目录 | 内容 |
| --- | --- |
| `unit/core/` | 核心工具、工作流基础能力和服务端模块单元测试 |
| `unit/skills/<skill>/` | 各 skill 的单元测试及领域内测试辅助数据 |
| `unit/web/` | React 工作流的纯函数、状态和 hook 测试 |
| `unit/architecture/` | 导入边界、目录约定等架构守卫测试 |
| `integration/` | CLI、HTTP API、工作流协作和端到端测试 |
| `browser/` | 使用真实 React 和浏览器运行的界面回归脚本 |
| `fixtures/` | 跨测试复用的固定输入和契约快照 |
| `helpers/` | 跨领域测试复用的辅助代码 |

常用命令：

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:core-skills
npm run test:pipeline
npm run test:workflow-browser
npm run test:all
```

新增测试时按被测层级归档。测试可以直接引用生产实现文件，但生产代码不能引用 `test/`。
