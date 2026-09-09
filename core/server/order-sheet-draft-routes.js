'use strict';

/**
 * 注册草稿接口及旧 URL 别名，保持响应与版本冲突语义。
 * @param {object} app Express 应用。
 * @param {object} dependencies 运行读取与草稿存取函数。
 * @returns {void}
 */
function registerOrderSheetDraftRoutes(app, { readRuntimeState, getOrderSheetDraft, saveOrderSheetDraft }) {
  const paths = ['/api/workflows/runs/:runId/order-sheet/draft', '/api/workflows/runs/:runId/order-sheet-draft'];
  app.get(paths, (req, res) => {
    try {
      const runId = req.params.runId;
      const runtime = readRuntimeState({ runId });
      if (!runtime || runtime.mode !== 'order-sheet') {
        return res.status(409).json({ ok: false, error: '当前运行不是刷单表流水线。' });
      }
      const draft = getOrderSheetDraft({ runId });
      return res.json({ ok: true, data: draft });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });
  app.post(paths, (req, res) => {
    try {
      const runId = req.params.runId;
      const runtime = readRuntimeState({ runId });
      if (!runtime || runtime.mode !== 'order-sheet') {
        return res.status(409).json({ ok: false, error: '当前运行不是刷单表流水线。' });
      }
      const saved = saveOrderSheetDraft({
        runId,
        items: Array.isArray(req.body?.items) ? req.body.items : undefined,
        groups: Array.isArray(req.body?.groups) ? req.body.groups : undefined,
        unassignedItems: Array.isArray(req.body?.unassignedItems) ? req.body.unassignedItems : undefined,
        dragCount: req.body?.dragCount,
        expectedRevision: req.body?.revision
      });
      return res.json({ ok: true, data: saved });
    } catch (err) {
      return res.status(err.code === 'ORDER_SHEET_DRAFT_CONFLICT' ? 409 : 400).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerOrderSheetDraftRoutes };
