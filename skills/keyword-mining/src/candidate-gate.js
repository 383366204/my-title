function parseSearchPopularity(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const match = String(value).replace(/,/g, '').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseMetricNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const matches = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return 0;
  const nums = matches.map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : 0;
}

function metricValue(data, names) {
  for (const name of names) {
    if (data && data[name] != null) return data[name];
  }
  return 0;
}

function evaluateMarketMetrics(sycmData, { minSearchPopularity = 50 } = {}) {
  const searchPopularity = parseSearchPopularity(sycmData.searchPopularity);
  const demandSupplyRatio = parseMetricNumber(sycmData.demandSupplyRatio);
  const clickRate = parseMetricNumber(metricValue(sycmData, ['clickRate', 'clickRatio']));
  const conversionRate = parseMetricNumber(metricValue(sycmData, ['conversionRate', 'payConversionRate', 'payConversion']));
  const buyerCount = parseMetricNumber(metricValue(sycmData, ['buyerCount', 'payBuyerCount', 'payBuyers']));
  const score = Math.round(
    Math.min(30, demandSupplyRatio * 15) +
    Math.min(25, searchPopularity / 20) +
    Math.min(20, clickRate * 1.2) +
    Math.min(15, conversionRate * 4) +
    Math.min(10, buyerCount / 5)
  );
  const evidence = [];
  if (demandSupplyRatio >= 0.5) evidence.push('供需比达标');
  if (clickRate >= 5) evidence.push('点击率达标');
  if (conversionRate >= 1) evidence.push('转化率达标');
  if (buyerCount >= 1) evidence.push('买家数达标');
  return {
    searchPopularity,
    demandSupplyRatio,
    clickRate,
    conversionRate,
    buyerCount,
    score,
    evidence,
    passed: searchPopularity >= minSearchPopularity && evidence.length > 0 && score >= 45
  };
}

/**
 * Decide whether a mined candidate may move toward distribution.
 * @param {object} candidate Scored candidate.
 * @param {object} [options] Options.
 * @param {number} [options.minSearchPopularity=50] Min SYCM popularity for verified status.
 * @returns {{gateStatus:string,canDistribute:boolean,gateReason:string,gateFlags:string[]}}
 */
function gateCandidate(candidate, { minSearchPopularity = 50 } = {}) {
  const flags = [];
  const compatibility = candidate.compatibility || {};
  if (compatibility.allowed === false) {
    return {
      gateStatus: 'rejected',
      canDistribute: false,
      gateReason: compatibility.reason || '候选词语义搭配不通过',
      gateFlags: [...(compatibility.flags || []), 'compatibility_rejected']
    };
  }

  if (candidate.nextAction === 'reject' || candidate.tier === 'reject') {
    return {
      gateStatus: 'rejected',
      canDistribute: false,
      gateReason: candidate.reason || '本地规则拒绝',
      gateFlags: ['local_rejected']
    };
  }

  if (!candidate.coreProduct) {
    return {
      gateStatus: 'review',
      canDistribute: false,
      gateReason: '未识别具体商品形态，仅可人工复核',
      gateFlags: ['missing_core_product']
    };
  }

  if (candidate.sycmData) {
    const market = evaluateMarketMetrics(candidate.sycmData, { minSearchPopularity });
    if (market.passed) {
      return {
        gateStatus: 'verified',
        canDistribute: true,
        gateReason: `生意参谋综合验真通过: 人气 ${market.searchPopularity}，供需比 ${market.demandSupplyRatio}，点击率 ${market.clickRate}，转化率 ${market.conversionRate}，买家数 ${market.buyerCount}`,
        gateFlags: ['sycm_verified', ...market.evidence],
        marketScore: market.score,
        marketMetrics: market
      };
    }
    if (market.searchPopularity >= minSearchPopularity) {
      return {
        gateStatus: 'review',
        canDistribute: false,
        gateReason: `搜索人气 ${market.searchPopularity} 达标，但供需/点击/转化/买家指标不足，需人工复核`,
        gateFlags: ['sycm_needs_more_market_evidence'],
        marketScore: market.score,
        marketMetrics: market
      };
    }
    return {
      gateStatus: 'rejected',
      canDistribute: false,
      gateReason: `生意参谋搜索人气不足: ${market.searchPopularity}`,
      gateFlags: ['sycm_low_popularity'],
      marketScore: market.score,
      marketMetrics: market
    };
  }

  if (candidate.localScore >= 62 || candidate.nextAction === 'sycm_verify') {
    return {
      gateStatus: 'candidate',
      canDistribute: false,
      gateReason: '本地候选词，需生意参谋验真后才能铺货',
      gateFlags: ['needs_sycm_verify']
    };
  }

  return {
    gateStatus: 'review',
    canDistribute: false,
    gateReason: '低分观察词，仅可人工复核',
    gateFlags: ['low_score_review']
  };
}

module.exports = { gateCandidate, parseSearchPopularity, parseMetricNumber, evaluateMarketMetrics };
