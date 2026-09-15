'use strict';

const POLICIES = {
  strict: { minSearchPopularity: 50, localThreshold: 55, verificationMode: 'blue' },
  balanced: { minSearchPopularity: 20, localThreshold: 45, verificationMode: 'blue_relaxed' },
  explore: { minSearchPopularity: 1, localThreshold: 35, verificationMode: 'hot' }
};

/**
 * 候选采集策略不修改货源评分、品牌约束或铺货审批规则。
 * @param {string} name 策略名称。
 * @returns {object} 独立的筛选配置。
 */
function researchPolicy(name = 'balanced') {
  return { ...(POLICIES[name] || POLICIES.balanced) };
}

module.exports = { researchPolicy };
