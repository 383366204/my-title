const { execSync } = require('child_process');
const { DEFAULT_DATA_DIR, addSeed, loadSeeds, normalizeKeyword } = require('./seed-store');
const { scoreKeyword } = require('./score-keyword');

/**
 * 从已验证关键词反向挖掘 sycm 关联词，评分后自动入库优质新种子。
 *
 * @param {string} keyword 已验证的关键词（来源词）
 * @param {object} [options] 选项
 * @param {string} [options.dataDir] 数据目录
 * @param {number} [options.topN=10] 取 topN 条关联词
 * @param {number} [options.minSearchPopularity=100] 最低搜索人气过滤
 * @param {boolean} [options.autoAddSeeds=true] 是否自动添加优质词为种子
 * @param {number} [options.maxNewSeeds=3] 最多自动添加的新种子数
 * @returns {{ok:boolean, sourceKeyword:string, relatedWords:Array<object>, newSeedsAdded:number}}
 */
async function reverseMine(keyword, options = {}) {
  const {
    dataDir = DEFAULT_DATA_DIR,
    topN = 10,
    minSearchPopularity = 100,
    autoAddSeeds = true,
    maxNewSeeds = 3
  } = options;

  if (!keyword || !String(keyword).trim()) {
    return { ok: false, sourceKeyword: keyword || '', relatedWords: [], newSeedsAdded: 0, error: '关键词不能为空' };
  }

  // 1) 调用 sycm 命令获取关联热搜词
  let sycmResult;
  try {
    const escaped = String(keyword).replace(/"/g, '\\"');
    const raw = execSync(
      `node bin/cli.js sycm "${escaped}" --mode hot --json`,
      { cwd: pathToProjectRoot(), encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    sycmResult = JSON.parse(raw);
  } catch (err) {
    // execSync 失败时尝试解析 stderr/stdout
    const msg = err.stderr || err.stdout || err.message;
    return { ok: false, sourceKeyword: keyword, relatedWords: [], newSeedsAdded: 0, error: `sycm查询失败: ${msg.slice(0, 200)}` };
  }

  const sycmItems = sycmResult.items || sycmResult.data || [];
  if (!Array.isArray(sycmItems) || sycmItems.length === 0) {
    return { ok: false, sourceKeyword: keyword, relatedWords: [], newSeedsAdded: 0, error: 'sycm返回数据格式异常或无关联词' };
  }

  /**
   * 从搜索人气字符串提取数值（如 "1200 ~ 2500 15%" → 1200）
   */
  function parseSearchPop(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const m = String(val).match(/(\d[\d]*)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // 2) 跳过第1条(通常是搜索词本身)，取 topN 条关联词
  const items = sycmItems.slice(1); // 跳过第1条
  const filtered = items
    .filter(item => parseSearchPop(item.searchPopularity) >= minSearchPopularity)
    .slice(0, topN);

  // 3) 加载已有种子池用于去重判断
  const existingSeeds = autoAddSeeds ? loadSeeds(dataDir) : [];
  const existingNormSet = new Set(existingSeeds.map(s => normalizeKeyword(s.keyword)));

  // 4) 对每个关联词打分，标记 promising / addedAsSeed
  const relatedWords = [];
  let addedCount = 0;

  for (const item of filtered) {
    const kw = item.keyword || '';
    const scored = scoreKeyword(kw);
    const promising = scored.localScore >= 65;
    let addedAsSeed = false;

    // 自动添加种子：localScore >= 70 且不在已有种子池中
    if (autoAddSeeds && scored.localScore >= 70 && addedCount < maxNewSeeds) {
      const normKw = normalizeKeyword(kw);
      if (!existingNormSet.has(normKw)) {
        try {
          addSeed(kw, {
            type: 'expand',
            source: 'reverse_mine',
            reason: `反向挖掘来源: ${keyword} (搜索人气:${item.searchPopularity}, 供需比:${item.demandSupplyRatio})`,
            priority: 6,
            dataDir
          });
          addedAsSeed = true;
          addedCount++;
          existingNormSet.add(normKw); // 防止同批次重复添加
        } catch (e) {
          // addSeed 可能因违禁词等抛错，静默跳过
        }
      }
    }

    relatedWords.push({
      keyword: kw,
      searchPopularity: item.searchPopularity || 0,
      demandSupplyRatio: item.demandSupplyRatio || 0,
      conversionRate: item.conversionRate || 0,
      score: scored.localScore,
      promising,
      addedAsSeed,
      reason: scored.reason,
      nextAction: scored.nextAction
    });
  }

  return {
    ok: true,
    sourceKeyword: keyword,
    totalCount: sycmResult.totalCount || sycmResult.data.length,
    relatedWords,
    newSeedsAdded: addedCount
  };
}

/**
 * 推算项目根目录（bin/cli.js 所在的上一级）
 * @returns {string}
 */
function pathToProjectRoot() {
  // reverse-mine.js 位于 skills/keyword-mining/src/
  // 项目根 = 向上三级 → my-title/
  return path.resolve(__dirname, '../../../');
}

const path = require('path');

module.exports = { reverseMine };
