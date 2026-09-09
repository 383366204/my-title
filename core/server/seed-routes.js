'use strict';

/**
 * 注册领域接口，保留业务逻辑并复用应用注入的能力。
 * @param {object} app Express 应用。
 * @param {object} dependencies 数据存取与平台能力。
 * @returns {void}
 */
function registerSeedRoutes(app, {
  DEFAULT_DATA_DIR,
  listSeeds,
  auditSeedPool,
  prepareSeedSuggestions,
  buildSeedReplenishmentPlan,
  addSeed,
  loadSeeds,
  saveSeeds,
  recordSeedEvent,
  fs,
  path
}) {
  // 1. GET /api/status - Get system and data file stats
  app.get('/api/status', (req, res) => {
    const stats = {
      env: {
        hasGlmKey: !!process.env.GLM_API_KEY,
        hasAliKey: !!process.env.ALI_1688_AK
      },
      files: {
        seedsCount: 0,
        seenCount: 0,
        rejectedCount: 0,
        cacheCount: 0
      }
    };

    try {
      const seeds = loadSeeds(DEFAULT_DATA_DIR);
      stats.files.seedsCount = seeds.length;
    } catch (_) {}

    const getLineCount = (filename) => {
      try {
        const file = path.join(DEFAULT_DATA_DIR, filename);
        if (fs.existsSync(file)) {
          return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length;
        }
      } catch (_) {}
      return 0;
    };

    stats.files.seenCount = getLineCount('seen-candidates.jsonl');
    stats.files.rejectedCount = getLineCount('rejected-candidates.jsonl');
    stats.files.cacheCount = getLineCount('verify-cache.jsonl');

    res.json({ ok: true, data: stats });
  });

  // 2. GET /api/seeds/audit - Read-only seed migration and health preview.
  app.get('/api/seeds/audit', (req, res) => {
    try {
      const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
      res.json({ ok: true, data: auditSeedPool(seeds) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 2.1 POST /api/seeds/suggestions/preview - Evaluate discoveries without writing the seed file.
  app.post('/api/seeds/suggestions/preview', (req, res) => {
    try {
      const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
      const result = prepareSeedSuggestions(req.body?.candidates, {
        existingSeeds: seeds,
        maxSuggestions: Number(req.body?.maxSuggestions || 5),
        minQualityScore: Number(req.body?.minQualityScore || 45)
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // 2.2 POST /api/seeds/replenishment/preview - Balance candidates across discovery sources.
  app.post('/api/seeds/replenishment/preview', (req, res) => {
    try {
      const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
      const result = buildSeedReplenishmentPlan(req.body?.sources, {
        existingSeeds: seeds,
        sourceQuotas: req.body?.sourceQuotas,
        maxSuggestions: Number(req.body?.maxSuggestions || 8),
        minQualityScore: Number(req.body?.minQualityScore || 45)
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // 2.3 GET /api/seeds - Get enriched, sorted seed list (including paused)
  app.get('/api/seeds', (req, res) => {
    try {
      const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
      res.json({ ok: true, data: auditSeedPool(seeds).profiles });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 3. POST /api/seeds - Add or update a seed
  app.post('/api/seeds', (req, res) => {
    const { keyword, category, priority, type, status } = req.body;
    try {
      const seed = addSeed(keyword, {
        category,
        priority: Number(priority),
        type,
        status,
        source: 'manual',
        dataDir: DEFAULT_DATA_DIR
      });
      res.json({ ok: true, data: seed });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // 4. POST /api/seeds/:keyword/toggle - Pause/resume a seed
  app.post('/api/seeds/:keyword/toggle', (req, res) => {
    const keywordToToggle = req.params.keyword;
    try {
      const seeds = loadSeeds(DEFAULT_DATA_DIR);
      const seed = seeds.find(s => s.keyword === keywordToToggle);
      if (!seed) {
        return res.status(404).json({ ok: false, error: '种子词不存在' });
      }
      seed.status = seed.status === 'paused' ? 'active' : 'paused';
      saveSeeds(seeds, DEFAULT_DATA_DIR);
      res.json({ ok: true, data: seed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 4.5 POST /api/seeds/:keyword/status - Move a seed through its lifecycle.
  app.post('/api/seeds/:keyword/status', (req, res) => {
    const keyword = req.params.keyword;
    const status = String(req.body?.status || '').trim().toLowerCase();
    const allowedStatuses = new Set(['active', 'observing', 'explore', 'cooling', 'paused', 'disabled']);
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ ok: false, error: '不支持的种子状态。' });
    }
    try {
      const seeds = loadSeeds(DEFAULT_DATA_DIR);
      const seed = seeds.find(item => item.keyword === keyword);
      if (!seed) return res.status(404).json({ ok: false, error: '种子词不存在' });
      seed.status = status;
      seed.statusReason = String(req.body?.reason || '').trim();
      seed.statusUpdatedAt = new Date().toISOString();
      saveSeeds(seeds, DEFAULT_DATA_DIR);
      recordSeedEvent({ type: 'status', keyword, status, reason: seed.statusReason, source: 'manual' }, DEFAULT_DATA_DIR);
      res.json({ ok: true, data: seed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 5. DELETE /api/seeds/:keyword - Delete a seed
  app.delete('/api/seeds/:keyword', (req, res) => {
    const keywordToDelete = req.params.keyword;
    try {
      const seeds = loadSeeds(DEFAULT_DATA_DIR);
      const index = seeds.findIndex(s => s.keyword === keywordToDelete);
      if (index === -1) {
        return res.status(404).json({ ok: false, error: '种子词不存在' });
      }
      seeds.splice(index, 1);
      saveSeeds(seeds, DEFAULT_DATA_DIR);
      res.json({ ok: true, message: '种子已删除' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 8. POST /api/config/clean - Clear verify cache, seen or rejected historical lists
  app.post('/api/config/clean', (req, res) => {
    const { type } = req.body; // 'cache' | 'seen' | 'rejected'
    const files = {
      cache: 'verify-cache.jsonl',
      seen: 'seen-candidates.jsonl',
      rejected: 'rejected-candidates.jsonl'
    };

    const filename = files[type];
    if (!filename) {
      return res.status(400).json({ ok: false, error: '不支持清除该类型文件' });
    }

    try {
      const file = path.join(DEFAULT_DATA_DIR, filename);
      if (fs.existsSync(file)) {
        fs.writeFileSync(file, '', 'utf8');
      }
      res.json({ ok: true, message: `${type} 缓存已清除` });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerSeedRoutes };
