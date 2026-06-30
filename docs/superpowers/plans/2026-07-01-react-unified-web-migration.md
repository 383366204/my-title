# React 统一 Web 迁移计划

## 背景

当前仓库曾同时存在两个前端入口：

- `web/`：原生 HTML/CSS/JS 选品页，挂在服务端根路径。
- `apps/web/`：React/Vite 工作流画布，曾以 `/workflow/` 独立页面提供。

用户确认 Web 工具尚未正式使用，因此采用长期方案：React 作为唯一主 Web 入口，旧原生页只保留为 `/legacy/` 回滚备份，不使用 iframe 过渡。

## 目标

1. 主入口 `/` 统一由 React 承接。
2. 原生页核心交互迁移进 React：工作台、种子池、挖词、标题生成、流程监控。
3. 工作流画布不再是新 tab，而是 React 应用内的一个工作区。
4. 后端 API 尽量保持稳定，避免同时重构前后端。
5. 旧 `web/` 暂时保留，后续确认 React 功能完整后再删除。

## Antigravity 协作结论

Antigravity 建议的最小可行顺序：

1. 调整依赖和 Vite base。
2. 先迁移 IndexedDB/历史状态相关能力，再迁移页面。
3. 组件化 Dashboard、Seeds、Mining、Title。
4. 切换 `bin/server.js` 静态入口。
5. 保留 legacy fallback，避免切换失败后无界面可用。

主要风险：

- SSE 挖词流如果未关闭会泄漏连接。
- Vite `base` 与 Express 静态路径不一致会导致资源 404。
- React 状态与浏览器历史库/IndexedDB 可能形成双数据源。
- 原生页里“候选词导入标题生成”的安全状态不能丢，否则会误把未验真词进入铺货。

## 本次迁移范围

### 已做

- `apps/web/src/WorkflowStudio.jsx`：从旧 `App.jsx` 拆出画布组件，保留流程监控和节点实验。
- `apps/web/src/App.jsx`：新增 React 统一入口和导航：
  - 工作台
  - 挖词选品
  - 标题生成
  - 流程监控
  - 节点实验
- `apps/web/src/App.css`：新增统一工作台样式。
- `apps/web/vite.config.js`：`base` 从 `/workflow/` 改为 `/`。
- `bin/server.js`：
  - `/legacy/` 挂载旧原生 Web。
  - `/` 挂载 React build。
  - 非 API 请求 fallback 到 React `index.html`。

### 保留后续收口

1. 把 `web/js/storage/*` 的 IndexedDB 历史能力抽成 ESM，接入 React 挖词结果重复检测。
2. 给“加入复核”按钮接入真实待确认铺货记录，而不是只展示禁用/启用状态。
3. 将原生页的配置清理入口迁移进 React 设置区。
4. 为 React 关键页面补充前端单元测试或 Playwright smoke。
5. React 功能稳定后，删除旧 `web/` 或仅保留静态归档。

## 验证

- `npm run web:build`
- `node --check bin/server.js`
- 必要时运行 `npm run test:all`
