'use strict';

const { removeBannedWords } = require('../../../core/banned-words');
const { cleanTitle } = require('./title-utils');

const CATEGORY_CONFLICTS = {
  '项链': ['耳环', '耳钉', '耳饰', '手链', '手镯', '戒指', '脚链', '发夹', '胸针'],
  '耳环': ['项链', '手链', '手镯', '戒指', '脚链'],
  '耳钉': ['项链', '手链', '手镯', '戒指', '脚链'],
  '手链': ['项链', '耳环', '耳钉', '戒指', '脚链'],
  '戒指': ['项链', '耳环', '耳钉', '手链', '脚链']
};

const MATERIAL_CONFLICTS = [
  ['纯银', ['钛钢', '合金', '镀银', '铜', '不锈钢']],
  ['真皮', ['人造革', 'pu', 'PU']],
  ['纯棉', ['涤纶', '雪纺', '聚酯纤维']]
];

function normalizeKeyword(keyword) {
  return cleanTitle(removeBannedWords(String(keyword || '').trim()));
}

function normalizeMetric(value, maxValue) {
  const num = Number(value) || 0;
  if (num <= 0 || maxValue <= 0) return 0;
  return Math.min(1, num / maxValue);
}

function getModifierWords(modifiers) {
  return (Array.isArray(modifiers) ? modifiers : [])
    .map(m => m && m.word)
    .filter(Boolean);
}

function hasCategoryConflict(keyword, coreWord) {
  const conflicts = CATEGORY_CONFLICTS[coreWord] || [];
  return conflicts.find(word => keyword.includes(word)) || '';
}

function hasRigidConflict(keyword, modifiers) {
  const rigidWords = (Array.isArray(modifiers) ? modifiers : [])
    .filter(m => m && m.rigidity === 'rigid')
    .map(m => String(m.word || '').toLowerCase());

  const lowerKeyword = keyword.toLowerCase();
  for (const [rigid, conflicts] of MATERIAL_CONFLICTS) {
    if (!rigidWords.includes(rigid.toLowerCase())) continue;
    const conflict = conflicts.find(word => lowerKeyword.includes(word.toLowerCase()));
    if (conflict) return conflict;
  }
  return '';
}

function semanticGroupOf(keyword, semanticGroups = {}) {
  for (const [group, words] of Object.entries(semanticGroups || {})) {
    if ((words || []).some(word => keyword.includes(word) || word.includes(keyword))) {
      return group;
    }
  }
  return '';
}

function productMatchScore(keyword, products, coreWord, modifierWords) {
  const productText = (products || []).map(p => p && (p.title || p.subject || p.name || '')).join('');
  let score = 0;
  if (keyword.includes(coreWord) || productText.includes(keyword)) score += 0.55;
  if (productText.includes(keyword)) score += 0.25;
  if (modifierWords.some(word => keyword.includes(word))) score += 0.15;
  if (keyword.length >= 2 && coreWord && keyword.includes(coreWord)) score += 0.05;
  return Math.min(1, score);
}

function classifyRole(score, row) {
  if (score >= 80 || (row.demandSupplyRatio >= 2 && row.conversionRate >= 2)) return 'must_keep';
  if (score >= 60) return 'optional_add';
  return 'avoid';
}

/**
 * Select SYCM keywords that are safe and useful for title generation.
 * @param {object} params
 * @param {Array<object>} params.sycmRows
 * @param {string} params.coreWord
 * @param {string} params.blueOceanWord
 * @param {Array<object>} params.modifiers
 * @param {object} params.semanticGroups
 * @param {Array<object>} params.products
 * @param {number} [params.maxKeywords=8]
 * @returns {{accepted: Array<object>, rejected: Array<object>, stats: object}}
 */
function selectSycmTitleKeywords({
  sycmRows = [],
  coreWord = '',
  blueOceanWord = '',
  modifiers = [],
  semanticGroups = {},
  products = [],
  maxKeywords = 8
} = {}) {
  const rows = Array.isArray(sycmRows) ? sycmRows : [];
  const modifierWords = getModifierWords(modifiers);
  const maxSearchPopularity = Math.max(1, ...rows.map(r => Number(r.searchPopularity) || 0));
  const maxClickRate = Math.max(1, ...rows.map(r => Number(r.clickRate) || 0));
  const maxConversionRate = Math.max(1, ...rows.map(r => Number(r.conversionRate) || 0));
  const maxDemandSupplyRatio = Math.max(1, ...rows.map(r => Number(r.demandSupplyRatio) || 0));
  const seen = new Set();
  const usedGroups = new Set();
  const acceptedCandidates = [];
  const rejected = [];

  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword);
    if (!keyword || keyword.length < 2) {
      rejected.push({ keyword: row.keyword || '', reason: '关键词为空或过短' });
      continue;
    }
    if (seen.has(keyword)) {
      rejected.push({ keyword, reason: '重复关键词' });
      continue;
    }
    seen.add(keyword);

    const categoryConflict = hasCategoryConflict(keyword, coreWord);
    if (categoryConflict) {
      rejected.push({ keyword, reason: `品类冲突: ${categoryConflict}` });
      continue;
    }

    const rigidConflict = hasRigidConflict(keyword, modifiers);
    if (rigidConflict) {
      rejected.push({ keyword, reason: `刚性属性冲突: ${rigidConflict}` });
      continue;
    }

    if (keyword !== blueOceanWord && blueOceanWord.includes(keyword)) {
      rejected.push({ keyword, reason: '已包含在蓝海词中' });
      continue;
    }

    const group = semanticGroupOf(keyword, semanticGroups);
    const match = productMatchScore(keyword, products, coreWord, modifierWords);
    const metricScore =
      normalizeMetric(row.searchPopularity, maxSearchPopularity) * 25 +
      normalizeMetric(row.clickRate, maxClickRate) * 20 +
      normalizeMetric(row.conversionRate, maxConversionRate) * 25 +
      normalizeMetric(row.demandSupplyRatio, maxDemandSupplyRatio) * 20 +
      match * 10;

    let score = Math.round(metricScore);
    if (row.demandSupplyRatio < 1) score -= 15;
    if (keyword.length > 12) score -= 8;
    if (group && usedGroups.has(group)) score -= 20;

    const role = classifyRole(score, row);
    if (score < 45) {
      rejected.push({ keyword, score, reason: '综合分不足', metrics: row });
      continue;
    }

    acceptedCandidates.push({
      keyword,
      score,
      role,
      group,
      reason: [
        row.searchPopularity ? `搜索人气${row.searchPopularity}` : '',
        row.clickRate ? `点击率${row.clickRate}%` : '',
        row.conversionRate ? `转化率${row.conversionRate}%` : '',
        row.demandSupplyRatio ? `供需比${row.demandSupplyRatio}` : '',
        match > 0 ? '商品匹配' : ''
      ].filter(Boolean).join('，'),
      searchPopularity: row.searchPopularity || 0,
      clickRate: row.clickRate || 0,
      conversionRate: row.conversionRate || 0,
      demandSupplyRatio: row.demandSupplyRatio || 0,
      metrics: row
    });
  }

  const accepted = [];
  for (const item of acceptedCandidates.sort((a, b) => b.score - a.score)) {
    if (item.group && usedGroups.has(item.group)) {
      rejected.push({ keyword: item.keyword, score: item.score, reason: `语义族重复: ${item.group}` });
      continue;
    }
    accepted.push(item);
    if (item.group) usedGroups.add(item.group);
    if (accepted.length >= maxKeywords) break;
  }

  return {
    accepted,
    rejected,
    stats: {
      total: rows.length,
      accepted: accepted.length,
      rejected: rejected.length
    }
  };
}

module.exports = { selectSycmTitleKeywords };
