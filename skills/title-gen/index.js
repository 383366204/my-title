// 标题生成技能入口点
const { run } = require('./src/index');
const { batchRun } = require('./src/batch');
const { generateTitlePipeline } = require('./src/pipeline');
const { extractKeywords } = require('./src/extract-core');
const { suggestKeywords, suggestAndVerify, STRATEGIES, VALID_STRATEGIES } = require('./src/keyword-suggester');

module.exports = {
  run,
  generateTitlePipeline,
  batchRun,
  extractKeywords,
  suggestKeywords,
  suggestAndVerify,
  STRATEGIES,
  VALID_STRATEGIES
};
