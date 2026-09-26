'use strict';
const { readCategoryState, saveCategoryState, categorySnapshot, chooseCategory, queryCategories } = require('../../skills/pipeline-flow/src/category-state');
const { normalizeExactKeywords } = require('../exact-keywords');
const { flowExport } = require('../../skills/pipeline-flow/src/export-flow');

/** @param {object} app Express 应用。 @param {object} deps 运行及任务依赖。 @returns {void} 注册类目获取与确认接口。 */
function registerCategoryRoutes(app, deps) {
  const tasks = new Map();
  const route = '/api/workflows/runs/:runId/categories';
  const lookup = req => ({ runId: req.params.runId, ...(deps.dataDir ? { dataDir: deps.dataDir } : {}) });
  const editable = context => {
    if (!['ready_to_distribute', 'needs_review', 'awaiting_user_confirmation', 'export_empty'].includes(context.run.status)) throw new Error('仅能在铺货复核阶段修改类目');
    const job = deps.jobs.readDistributionJob(`${context.run.runId}-distribution`);
    if (job) throw new Error('此运行已有铺货任务，请新建运行修改类目，避免改变执行快照');
  };
  app.post(`${route}/copy`, (req, res) => {
    try {
      const context = readCategoryState(lookup(req));
      const snapshot = categorySnapshot(context);
      const format = req.body.format;
      if (!['full', 'title', 'url'].includes(format) || !Array.isArray(req.body.items) || !req.body.items.length) throw new Error('复制格式或商品清单无效');
      const lines = req.body.items.map(item => {
        const row = snapshot.rows.find(row => row.url === item.url);
        if (!row) throw new Error('商品不在当前运行中');
        if (format === 'url') return row.url;
        if (typeof item.title !== 'string' || !item.title.trim() || /[\r\n]|\$\$/.test(item.title)) throw new Error('铺货标题为空或包含格式分隔符');
        if (format === 'title') return `${row.url}$$${item.title}`;
        if (!row.category) throw new Error('请先补齐生意参谋类目，或选择不含类目的复制格式');
        return `${row.url}$$${item.title}$$${row.category}`;
      });
      res.json({ ok: true, data: { text: lines.join('\n'), version: snapshot.version } });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.get(route, (req, res) => {
    try {
      const context = readCategoryState(lookup(req));
      if (context.state.job?.status === 'running' && !tasks.has(req.params.runId)
        && deps.workbench.current?.runId !== req.params.runId) {
        context.state.job.status = 'paused';
        context.state.job.inFlight = false;
        context.state.job.error = '服务已重启，请继续获取类目';
        saveCategoryState(context);
      }
      res.json({ ok: true, data: { ...categorySnapshot(context), locked: Boolean(deps.jobs.readDistributionJob(`${context.run.runId}-distribution`)) } });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.post(route, async (req, res) => {
    let reservation;
    try {
      const options = lookup(req);
      const context = readCategoryState(options);
      editable(context);
      if (req.body.version !== context.state.version) return res.status(409).json({ ok: false, error: '类目已更新，请刷新后重试' });
      const action = req.body.action;
      if (action === 'pause') {
        if (context.state.job?.status === 'running') { context.state.job.status = 'paused'; saveCategoryState(context); }
      } else {
        if (tasks.has(req.params.runId)) throw new Error('正在获取类目，请暂停并等待当前查询结束');
        reservation = deps.workbench.tryAcquire({ mode: 'category', runId: req.params.runId });
        if (!reservation) throw new Error('已有工作流正在运行，请等待结束');
        if (action === 'select') {
          chooseCategory(context, req.body);
          await flowExport(options);
        } else if (action === 'query' || action === 'resume') {
          if (action === 'query') {
            if (!Array.isArray(req.body.urls) || !req.body.urls.length) throw new Error('请选择需要获取类目的商品');
            const groups = new Map();
            for (const url of new Set(req.body.urls)) {
              const row = context.generated.find(item => item.url === url);
              if (!row) throw new Error('商品不在当前运行中');
              const words = normalizeExactKeywords(req.body.queryWord || row.selectedKeyword || row.keyword);
              if (words.length !== 1) throw new Error('每件商品需要一个明确的类目查询词');
              if (req.body.queryWord && req.body.urls.length !== 1) throw new Error('修改查询词时请逐商品操作');
              if (!groups.has(words[0])) groups.set(words[0], []);
              groups.get(words[0]).push(url);
            }
            context.state.job = { status: 'running', completed: 0, error: '', requests: [...groups].map(([queryWord, urls]) => ({ queryWord, urls })) };
            // 重查立即撤销旧选择，失败或暂停时不能悄悄沿用旧类目。
            for (const request of context.state.job.requests) {
              for (const url of request.urls) {
                const row = context.generated.find(item => item.url === url);
                context.state.rows[url] = { keyword: row.selectedKeyword || row.keyword || '',
                  evidence: { source: 'sycm', queryWord: request.queryWord, candidates: [], recommended: '' }, selection: null, error: '' };
              }
            }
          } else {
            if (context.state.job?.status !== 'paused') throw new Error('没有可继续的类目任务');
            context.state.job.status = 'running'; context.state.job.error = '';
          }
          saveCategoryState(context);
          tasks.set(req.params.runId, true);
          deps.workbench.runReserved(reservation, async () => {
            await queryCategories({ ...options, extractor: deps.extractor });
            await flowExport(options);
          })
            .catch(error => deps.originalError?.(error.message))
            .finally(() => tasks.delete(req.params.runId));
        } else throw new Error('不支持的类目操作');
      }
      res.json({ ok: true, data: categorySnapshot(context) });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
    finally { if (reservation && !reservation.promise) deps.workbench.release(reservation); }
  });
}

module.exports = { registerCategoryRoutes };
