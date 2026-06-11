const fs = require('fs');
const path = require('path');
const { normalizeKeyword, listSeeds, DEFAULT_DATA_DIR } = require('./seed-store');

const CONFIG_DIR = path.resolve(__dirname, '../config');

function unique(words) {
  return [...new Set((words || []).map(normalizeKeyword).filter(Boolean))];
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return fallback;
  }
}

function mergeWordMap(base, extra) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(extra || {})) {
    output[key] = unique([...(output[key] || []), ...(Array.isArray(value) ? value : [])]);
  }
  return output;
}

function loadKeywordConfig(options = {}) {
  const configDir = options.configDir || CONFIG_DIR;
  return {
    products: readJson(path.join(configDir, 'products.json'), {}),
    synonyms: readJson(path.join(configDir, 'synonyms.json'), {}),
    rejectRules: readJson(path.join(configDir, 'reject-rules.json'), {}),
    facets: readJson(path.join(configDir, 'facets.json'), {})
  };
}

function seedProductWords({ dataDir = DEFAULT_DATA_DIR, maxSeeds = 200 } = {}) {
  try {
    return listSeeds({ dataDir, includePaused: false })
      .slice(0, maxSeeds)
      .map(seed => seed.keyword);
  } catch (_) {
    return [];
  }
}

function configuredProductWords(defaultWords = [], options = {}) {
  const config = loadKeywordConfig(options);
  return unique([
    ...defaultWords,
    ...(config.products.productWords || []),
    ...seedProductWords(options),
    ...(options.extraProductWords || [])
  ]).sort((a, b) => b.length - a.length);
}

function synonymMap(options = {}) {
  const config = loadKeywordConfig(options);
  const canonical = config.synonyms.canonical || {};
  const map = new Map();
  for (const [target, aliases] of Object.entries(canonical)) {
    const normalizedTarget = normalizeKeyword(target);
    if (!normalizedTarget) continue;
    map.set(normalizedTarget, normalizedTarget);
    for (const alias of aliases || []) {
      const normalizedAlias = normalizeKeyword(alias);
      if (normalizedAlias) map.set(normalizedAlias, normalizedTarget);
    }
  }
  return map;
}

function normalizeSynonyms(keyword, options = {}) {
  let value = normalizeKeyword(keyword);
  if (!value) return '';
  const entries = [...synonymMap(options).entries()]
    .filter(([from, to]) => from && to && from !== to)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    value = value.split(from).join(to);
  }
  return value;
}

function mergeFacets(defaultFacets = {}, options = {}) {
  const config = loadKeywordConfig(options);
  return mergeWordMap(defaultFacets, config.facets.facets || config.facets);
}

function configuredRejectFacetRules(options = {}) {
  const config = loadKeywordConfig(options);
  return Array.isArray(config.rejectRules.facetRules) ? config.rejectRules.facetRules : [];
}

module.exports = {
  CONFIG_DIR,
  loadKeywordConfig,
  configuredProductWords,
  normalizeSynonyms,
  mergeFacets,
  configuredRejectFacetRules
};
