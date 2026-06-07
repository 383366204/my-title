const REJECT_RULES = [
  { includes: ['戒指', '宝宝'], reason: '儿童首饰风险高' },
  { includes: ['戒指', '儿童'], reason: '儿童首饰风险高' },
  { includes: ['戒指', '老人'], reason: '人群组合不自然' },
  { includes: ['手绳', '不锈钢'], reason: '手绳材质不匹配' },
  { includes: ['手绳', '钛钢'], reason: '手绳材质不匹配' },
  { includes: ['儿童玩具', '纯银'], reason: '儿童玩具材质不匹配' },
  { includes: ['儿童玩具', '玛瑙'], reason: '儿童玩具材质不匹配' },
  { includes: ['儿童玩具', '朱砂'], reason: '儿童玩具材质不匹配' },
  { includes: ['儿童玩具', '和田玉'], reason: '儿童玩具材质不匹配' },
  { includes: ['儿童玩具', '办公室'], reason: '儿童玩具场景不匹配' },
  { includes: ['收纳盒', '情侣'], reason: '人群组合不自然' },
  { includes: ['收纳盒', '妈妈'], reason: '人群组合过泛' },
  { includes: ['宠物玩具', '纯银'], reason: '宠物玩具材质不匹配' },
  { includes: ['宠物玩具', '玛瑙'], reason: '宠物玩具材质不匹配' },
  { includes: ['宠物玩具', '朱砂'], reason: '宠物玩具材质不匹配' },
  { includes: ['狗狗', '逗猫棒'], reason: '宠物对象冲突' },
  { includes: ['猫咪', '狗咬胶'], reason: '宠物对象冲突' }
];

function rejectCandidate(keyword) {
  const value = String(keyword || '');
  const hit = REJECT_RULES.find(rule => rule.includes.every(part => value.includes(part)));
  if (!hit) return { rejected: false, reason: '' };
  return { rejected: true, reason: hit.reason };
}

module.exports = { REJECT_RULES, rejectCandidate };
