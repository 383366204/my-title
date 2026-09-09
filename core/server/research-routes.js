'use strict';

/**
 * 注册领域接口，保留业务逻辑并复用应用注入的能力。
 * @param {object} app Express 应用。
 * @param {object} dependencies 数据存取与平台能力。
 * @returns {void}
 */
function registerResearchRoutes(app, {
  logStorage,
  originalLog,
  mineKeywords,
  DEFAULT_DATA_DIR,
  generateTitlePipeline,
  searchAll,
  searchTaobaoTitles,
  extractNouns,
  precheckCandidates,
  fetchOpportunities,
  extractSycmData,
  resolve1688ShareText
}) {
  // 6. GET /api/mine/run - Run keyword mining with live logs via SSE
  app.get('/api/mine/run', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const options = {
      count: parseInt(req.query.count, 10) || 50,
      source: req.query.source || 'local',
      sycmPrecheck: req.query.sycmPrecheck === 'true',
      autoSeedHighTier: req.query.autoSeedHighTier === 'true',
      minSearchPopularity: parseInt(req.query.minSearchPopularity, 10) || 50,
      dataDir: DEFAULT_DATA_DIR,
      persist: true
    };

    let isClosed = false;
    req.on('close', () => {
      isClosed = true;
      originalLog(`🔌 客户端连接已关闭，挖掘任务的响应通道已终止。`);
    });

    logStorage.run(res, async () => {
      try {
        console.log(`🚀 开始挖掘关键词任务，参数:`, JSON.stringify(options));
        const result = await mineKeywords(options);
        if (!isClosed) {
          res.write(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`);
        }
      } catch (err) {
        if (!isClosed) {
          console.error(`❌ 挖掘任务发生异常:`, err.message);
          res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        }
      } finally {
        res.end();
      }
    });
  });

  // 7. POST /api/title/generate - Generate product titles & advice
  app.post('/api/title/generate', async (req, res) => {
    const { keyword, maxLength, useImageSearch, peerTitles } = req.body;
    if (!keyword) {
      return res.status(400).json({ ok: false, error: '关键词不能为空' });
    }

    try {
      // 调用 generateTitlePipeline，注入 1688 商品搜索适配器，解决货源空结果的 Bug (P1)
      const result = await generateTitlePipeline(keyword, {
        maxLength: parseInt(maxLength, 10) || 60,
        useImageSearch: !!useImageSearch,
        peerTitles: Array.isArray(peerTitles) ? peerTitles : null,
        searchProducts: ({ coreWord, blueOceanWord, modifiers, semanticGroups }) =>
          searchAll(coreWord, blueOceanWord, modifiers, semanticGroups)
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 9. POST /api/miner/peer - Extract competitor word roots & verify with SYCM
  app.post('/api/miner/peer', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) {
      return res.status(400).json({ ok: false, error: '关键词/链接不能为空' });
    }

    try {
      console.log(`🔍 正在获取淘宝同行 "${keyword}" 的标题...`);
      let titles = await searchTaobaoTitles(keyword, { maxResults: 15 });

      if (!titles.length) {
        return res.json({
          ok: true,
          data: [],
          warning: '未获取到淘宝同行标题，未使用模拟数据。请确认淘宝工具可用，或换一个关键词重试。'
        });
      }

      // Segment titles and extract nouns
      const nounCandidates = extractNouns(titles).slice(0, 15);
      if (!nounCandidates.length) {
        return res.json({ ok: true, data: [] });
      }

      console.log(`✓ 提取出候选词根:`, nounCandidates.map(c => c.word).join(', '));
      console.log(`🔌 正在对提取的候选词根进行生意参谋热度校验...`);

      // Verify with SYCM (popularity > 10)
      let pcResult;
      try {
        pcResult = await precheckCandidates(nounCandidates.map(c => ({ keyword: c.word })), { minSearchPopularity: 10 });
      } catch (sycmErr) {
        return res.status(502).json({
          ok: false,
          error: `生意参谋验证失败，未输出未验真词根: ${sycmErr.message}`
        });
      }

      const verified = pcResult.passed.map(p => {
        const match = nounCandidates.find(c => c.word === p.keyword);
        return {
          word: p.keyword,
          count: match ? match.count : 1,
          searchPopularity: p.searchPopularity
        };
      }).sort((a, b) => b.searchPopularity - a.searchPopularity);

      res.json({ ok: true, data: verified });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 10. POST /api/miner/opportunities - Extract 1688 opportunities & verify with SYCM
  app.post('/api/miner/opportunities', async (req, res) => {
    try {
      console.log(`🔍 正在抓取 1688 爆款商机商品...`);
      const bizData = await fetchOpportunities();
      const products = bizData?.opportunityOffers || [];
      const titles = products.map(p => p.title || p.subject || '').filter(Boolean);

      if (!titles.length) {
        return res.json({ ok: true, data: [] });
      }

      // Segment and extract nouns
      const nounCandidates = extractNouns(titles).slice(0, 15);
      if (!nounCandidates.length) {
        return res.json({ ok: true, data: [] });
      }

      console.log(`🔌 正在对 1688 商机词根进行生意参谋热度校验...`);
      let pcResult;
      try {
        pcResult = await precheckCandidates(nounCandidates.map(c => ({ keyword: c.word })), { minSearchPopularity: 10 });
      } catch (sycmErr) {
        return res.status(502).json({
          ok: false,
          error: `生意参谋验证失败，未输出未验真商机词根: ${sycmErr.message}`
        });
      }

      const verified = pcResult.passed.map(p => {
        const match = nounCandidates.find(c => c.word === p.keyword);
        return {
          word: p.keyword,
          count: match ? match.count : 1,
          searchPopularity: p.searchPopularity
        };
      }).sort((a, b) => b.searchPopularity - a.searchPopularity);

      res.json({ ok: true, data: verified });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 11. POST /api/miner/sycm-market - Directly grab related words from SYCM
  app.post('/api/miner/sycm-market', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) {
      return res.status(400).json({ ok: false, error: '核心词根不能为空' });
    }

    try {
      console.log(`🔍 正在直接从生意参谋抓取 "${keyword}" 的关联词榜单...`);
      const sycmRes = await extractSycmData(keyword, { mode: 'hot', maxPages: 1, port: 9222 });
      const items = sycmRes.data || [];

      const data = items.map(item => ({
        word: item.keyword,
        searchPopularity: parseSearchPop(item.searchPopularity),
        demandSupplyRatio: parsePercentOrNumber(item.demandSupplyRatio)
      })).sort((a, b) => b.searchPopularity - a.searchPopularity);

      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 2.6 POST /api/1688/resolve-share - 将手机分享口令或短链转换成标准商品链接
  app.post('/api/1688/resolve-share', async (req, res) => {
    try {
      const input = String(req.body?.input || '').trim();
      if (!input) return res.status(400).json({ ok: false, error: '分享内容为空。' });
      if (input.length > 8192) return res.status(400).json({ ok: false, error: '单条分享内容过长。' });
      const result = await resolve1688ShareText(input);
      if (!result) return res.status(422).json({ ok: false, error: '没有从分享内容中识别到有效的 1688 商品。' });
      return res.json({ ok: true, data: result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: `解析 1688 分享内容失败：${err.message}` });
    }
  });
}

function parseSearchPop(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const m = String(val).replace(/,/g, '').match(/(\d[\d]*)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parsePercentOrNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).trim();
  if (str.endsWith('%')) {
    const num = parseFloat(str.slice(0, -1));
    return Number.isFinite(num) ? num / 100 : 0;
  }
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 0;
}

module.exports = { registerResearchRoutes };
