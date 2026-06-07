const fs = require('fs');
const path = require('path');

const DEFAULT_OPPORTUNITY_DIR = path.join(process.cwd(), 'data', 'opportunities');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function asciiJson(value) {
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, ch => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

function appendJsonl(file, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const lines = list
    .filter(Boolean)
    .map(row => asciiJson(row))
    .join('\n');
  if (!lines) return;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, lines + '\n', 'utf8');
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function opportunityFiles(dataDir = DEFAULT_OPPORTUNITY_DIR) {
  return {
    dir: dataDir,
    keywords: path.join(dataDir, 'keywords.jsonl'),
    products: path.join(dataDir, 'products.jsonl'),
    rejected: path.join(dataDir, 'rejected.jsonl'),
    events: path.join(dataDir, 'events.jsonl')
  };
}

function stableKey(row = {}) {
  return row.offerId || row.url || row.keyword || row.signature || '';
}

function appendOpportunity(type, rows, options = {}) {
  const files = opportunityFiles(options.dataDir);
  const file = files[type] || files.events;
  const now = new Date().toISOString();
  const list = (Array.isArray(rows) ? rows : [rows])
    .filter(Boolean)
    .map(row => ({
      ...row,
      type,
      key: row.key || stableKey(row),
      runId: row.runId || options.runId || '',
      recordedAt: row.recordedAt || now
    }));
  appendJsonl(file, list);
  return { file, count: list.length };
}

function summarizeOpportunities(options = {}) {
  const files = opportunityFiles(options.dataDir);
  const keywords = readJsonl(files.keywords);
  const products = readJsonl(files.products);
  const rejected = readJsonl(files.rejected);
  return {
    ok: true,
    dir: files.dir,
    files,
    counts: {
      keywords: keywords.length,
      products: products.length,
      rejected: rejected.length
    },
    topKeywords: keywords
      .slice()
      .sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0))
      .slice(0, Number(options.limit || 10)),
    topProducts: products
      .slice()
      .sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0))
      .slice(0, Number(options.limit || 10))
  };
}

module.exports = {
  DEFAULT_OPPORTUNITY_DIR,
  opportunityFiles,
  appendOpportunity,
  summarizeOpportunities,
  readJsonl
};
