const {
  DEFAULT_DATA_DIR,
  addSeed,
  listSeeds,
  loadSeeds,
  saveSeeds,
  recordSeedEvent,
  normalizeKeyword,
  getSeedScore
} = require('./src/seed-store');
const { expandSeed, expandSeeds } = require('./src/expand-keywords');
const { scoreKeyword } = require('./src/score-keyword');
const { mineKeywords, clusterBySignature, diversifyCandidates } = require('./src/pipeline');
const { rejectCandidate } = require('./src/reject-combinations');
const { reverseMine } = require('./src/reverse-mine');
const { keywordSignature } = require('./src/keyword-signature');
const { generateAIKeywordCandidates, normalizeAIResponse, parseAIJson } = require('./src/ai-mine-keywords');
const { normalizeSynonyms, configuredProductWords } = require('./src/config-loader');
const { classifySeed } = require('./src/seed-classifier');
const { checkExpansionCompatibility } = require('./src/facet-compatibility');
const { gateCandidate } = require('./src/candidate-gate');
const { extractShortRoot, selectShortRoots, recordRootQueries } = require('./src/root-keywords');

module.exports = {
  DEFAULT_DATA_DIR,
  addSeed,
  listSeeds,
  loadSeeds,
  saveSeeds,
  recordSeedEvent,
  normalizeKeyword,
  getSeedScore,
  expandSeed,
  expandSeeds,
  scoreKeyword,
  mineKeywords,
  clusterBySignature,
  diversifyCandidates,
  generateAIKeywordCandidates,
  normalizeAIResponse,
  parseAIJson,
  normalizeSynonyms,
  configuredProductWords,
  classifySeed,
  checkExpansionCompatibility,
  gateCandidate,
  extractShortRoot,
  selectShortRoots,
  recordRootQueries,
  keywordSignature,
  rejectCandidate,
  reverseMine
};
