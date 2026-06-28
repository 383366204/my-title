const { execFile } = require('child_process');
const path = require('path');
const { parseMetricNumber } = require('./candidate-gate');

/**
 * SYCM 预检：并发查询候选词的搜索人气，过滤低于阈值的词
 * @param {Array<{keyword:string, ...}>} candidates 候选词列表
 * @param {object} [options] 选项
 * @param {number} [options.minSearchPopularity=50] 最低搜索人气阈值
 * @param {number} [options.timeout=25000] 每个查询超时(ms)
 * @param {number} [options.concurrency=2] 并发数
 * @returns {{passed:Array, filtered:Array, stats:{total:number, passed:number, filtered:number, errors:number}}}
 */
async function precheckCandidates(candidates, { minSearchPopularity = 50, timeout = 25000, concurrency = 2 } = {}) {
  const stats = { total: candidates.length, passed: 0, filtered: 0, errors: 0 };
  const passed = [];
  const filtered = [];

  // 并发控制：每次最多 concurrency 个请求
  async function runBatch(items) {
    return Promise.all(items.map(item => checkOne(item)));
  }

  async function checkOne(candidate) {
    const keyword = candidate.keyword;
    try {
      const result = await execSycmQuery(keyword, timeout);
      if (result === null) {
        // 无数据或解析失败 → 标记过滤
        stats.filtered++;
        filtered.push({ ...candidate, filtered: true, reason: 'sycm无数据或解析失败' });
        return;
      }
      if (result.searchPopularity < minSearchPopularity) {
        stats.filtered++;
        filtered.push({ ...candidate, filtered: true, reason: `搜索人气${result.searchPopularity}低于阈值${minSearchPopularity}`, ...result });
        return;
      }
      // 通过预检
      stats.passed++;
      passed.push({ ...candidate, ...result });
    } catch (err) {
      stats.errors++;
      filtered.push({ ...candidate, filtered: true, reason: `sycm查询异常: ${err.message}` });
    }
  }

  function execSycmQuery(keyword, msTimeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`sycm查询超时(${msTimeout}ms): ${keyword}`));
      }, msTimeout);

      const cliPath = path.resolve(__dirname, '../../../bin/cli.js');
      execFile('node', [cliPath, 'sycm', keyword, '--mode', 'hot', '--json'], { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        clearTimeout(timer);
        if (err) {
          reject(new Error(`进程异常: ${err.message}${stderr ? ' | ' + stderr.trim() : ''}`));
          return;
        }
        try {
          const data = JSON.parse(stdout.trim());
          const metrics = extractSycmMetricsFromJson(data);
          if (!metrics) {
            resolve(null); // 无数据
            return;
          }
          resolve(metrics);
        } catch (e) {
          resolve(null); // JSON 解析失败视为无数据
        }
      });
    });
  }

  // 分批执行
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    await runBatch(batch);
  }

  return { passed, filtered, stats };
}

function extractSearchPopularityFromSycmJson(payload) {
  const metrics = extractSycmMetricsFromJson(payload);
  return metrics ? metrics.searchPopularity : null;
}

function extractSycmMetricsFromJson(payload) {
  const rows = Array.isArray(payload && payload.items)
    ? payload.items
    : Array.isArray(payload && payload.data)
      ? payload.data
      : [];
  if (!rows.length || rows[0].searchPopularity == null) return null;
  const row = rows[0];
  const searchPopularity = parseMetricNumber(row.searchPopularity);
  if (!Number.isFinite(searchPopularity)) return null;
  return {
    searchPopularity,
    demandSupplyRatio: parseMetricNumber(row.demandSupplyRatio),
    clickRate: parseMetricNumber(row.clickRate),
    conversionRate: parseMetricNumber(row.conversionRate || row.payConversionRate),
    buyerCount: parseMetricNumber(row.buyerCount || row.payBuyerCount)
  };
}

module.exports = { precheckCandidates, extractSearchPopularityFromSycmJson, extractSycmMetricsFromJson };
