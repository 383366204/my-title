const { checkBannedWords } = require('../../../core/banned-words');
const { normalizeKeyword } = require('./seed-store');
const { classifySeed } = require('./seed-classifier');
const { productFamily } = require('./product-words');

const SENSITIVE_MARKERS = [
  '政治', '选举', '战争', '军演', '伤亡', '死亡', '遇难', '自杀', '凶杀', '爆炸',
  '地震灾区', '恐怖袭击', '疫情死亡', '性侵', '赌博', '毒品', '诈骗'
];
const BRAND_IP_MARKERS = [
  '迪士尼', '漫威', '宝可梦', '奥特曼', '哈利波特', '三丽鸥', '小米', '华为',
  '苹果手机', '耐克', '阿迪达斯', '香奈儿', '爱马仕', '明星同款', '影视同款'
];
const ABSTRACT_ROOTS = ['好物', '神器', '用品', '生活', '百货', '周边', '潮流', '高级感', '氛围感'];

function findMarkers(text, markers) {
  const value = String(text || '');
  return markers.filter(marker => value.includes(marker));
}

/**
 * Assess whether an inspiration may be commercialized safely.
 * @param {object} inspiration Inspiration row.
 * @returns {{ok:boolean,riskFlags:string[],rejectReason:string}} Guard decision.
 */
function assessInspiration(inspiration = {}) {
  const text = `${inspiration.rawSourceText || ''}${inspiration.inspirationWord || ''}`;
  const sensitive = findMarkers(text, SENSITIVE_MARKERS);
  const brandIp = findMarkers(text, BRAND_IP_MARKERS);
  const riskFlags = [
    ...sensitive.map(marker => `sensitive:${marker}`),
    ...brandIp.map(marker => `brand_ip:${marker}`)
  ];
  return {
    ok: riskFlags.length === 0,
    riskFlags,
    rejectReason: sensitive.length > 0
      ? 'sensitive_or_negative_news'
      : brandIp.length > 0
        ? 'brand_or_ip_risk'
        : ''
  };
}

/**
 * Validate a productized root without consulting the seed pool.
 * @param {object} candidate Productized root row.
 * @param {object} [options] Keyword config options.
 * @returns {object} Candidate with grounding decision.
 */
function assessRootCandidate(candidate = {}, options = {}) {
  const rootKeyword = normalizeKeyword(candidate.rootKeyword || candidate.keyword || '');
  const banned = checkBannedWords(rootKeyword);
  const brandIp = findMarkers(rootKeyword, BRAND_IP_MARKERS);
  const abstract = findMarkers(rootKeyword, ABSTRACT_ROOTS);
  const classification = classifySeed({ keyword: rootKeyword, category: candidate.category || '' }, {
    ...options,
    maxSeeds: 0,
    extraProductWords: options.extraProductWords || []
  });
  const lengthValid = rootKeyword.length >= 2 && rootKeyword.length <= 8;
  const concrete = ['product', 'qualified_product'].includes(classification.role) && Boolean(classification.coreProduct);
  let rejectReason = '';
  if (!rootKeyword) rejectReason = 'empty_root';
  else if (!lengthValid) rejectReason = 'root_length_out_of_range';
  else if (!banned.valid) rejectReason = 'banned_word';
  else if (brandIp.length > 0) rejectReason = 'brand_or_ip_risk';
  else if (abstract.length > 0) rejectReason = 'abstract_root';
  else if (!concrete) rejectReason = 'not_concrete_product';
  const familyKey = productFamily(classification.coreProduct, { ...options, maxSeeds: 0 }) || classification.coreProduct;
  return {
    ...candidate,
    rootKeyword,
    keyword: rootKeyword,
    coreProduct: classification.coreProduct || '',
    familyKey,
    groundingStatus: rejectReason ? 'rejected' : 'passed',
    groundingReason: classification.reason,
    riskFlags: [
      ...(!banned.valid ? banned.words.map(word => `banned:${word}`) : []),
      ...brandIp.map(marker => `brand_ip:${marker}`),
      ...abstract.map(marker => `abstract:${marker}`)
    ],
    status: rejectReason ? 'rejected' : 'grounded',
    rejectReason
  };
}

module.exports = {
  ABSTRACT_ROOTS,
  BRAND_IP_MARKERS,
  SENSITIVE_MARKERS,
  assessInspiration,
  assessRootCandidate
};
