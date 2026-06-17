"use strict";
const { test } = require('node:test');
const assert = require('assert');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function resolveProjectModulePath(modulePath) {
  const normalized = modulePath.replace(/\\/g, '/');
  const projectMarker = '/my-title/';
  const projectIndex = normalized.indexOf(projectMarker);
  if (projectIndex !== -1) {
    return path.join(PROJECT_ROOT, normalized.slice(projectIndex + projectMarker.length));
  }
  const mntMatch = normalized.match(/^\/mnt\/[a-z]\/(.+)$/i);
  if (mntMatch) return path.join(path.parse(PROJECT_ROOT).root, mntMatch[1]);
  return modulePath;
}

// Helper to mock a module's exports by replacing require.cache entry
function mockModule(modulePath, exportsObj) {
  const resolvedPath = resolveProjectModulePath(modulePath);
  const key = require.resolve(resolvedPath);
  if (exportsObj && exportsObj.extractCoreAndModifiers && !exportsObj.extractKeywords) {
    exportsObj.extractKeywords = async (_type, options = {}) => exportsObj.extractCoreAndModifiers(options.data);
  }
  require.cache[key] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsObj
  };
}

function reloadIndex() {
  // Clear index.js from cache to pick up mocks
  const idxPath = require.resolve('../src/index.js');
  const llmPath = require.resolve('../../../core/llm');
  delete require.cache[idxPath];
  delete require.cache[llmPath];
  return require('../src/index.js');
}

test('Test 1: Complete happy path', async () => {
  // Mock extract-core.js
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => {
      return {
        coreWord: '项链',
        modifiers: [
          { word: '纯银', rigidity: 'rigid' },
          { word: '女', rigidity: 'rigid' },
          { word: '高级感', rigidity: 'optional' }
        ]
      };
    }
  });

  // Mock search-1688.js (from skills/alibaba1688!)
  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => {
      return [
        { id: 'p1', title: '银质项链', url: 'https://example/p1', price: 100, stats: { last30DaysSales: 20, goodRates: 0.95, repurchaseRate: 0.3 } },
        { id: 'p2', title: '纯银项链女款', url: 'https://example/p2', price: 120, stats: { last30DaysSales: 12, goodRates: 0.9, repurchaseRate: 0.25 } }
      ];
    },
    searchAndFilter: async () => []
  });

  // Mock search-taobao.js
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => []
  });

  class MockGLMClient1 {
    constructor(config) {}
    async selectAndGenerate({ blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength }) {
      return {
        selectedProducts: [
          { id: 'p1', score: 9, reason: '理由1', priceAdvice: '定价1', risk: '风险1' },
          { id: 'p2', score: 8, reason: '理由2', priceAdvice: '定价2', risk: '风险2' }
        ],
        titles: [
          { productId: 'p1', title: blueOceanWord + ' 版本1' },
          { productId: 'p2', title: blueOceanWord + ' 版本2' },
          { productId: 'p3', title: blueOceanWord + ' 版本3' }
        ],
        overallAdvice: ''
      };
    }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient1);

  const { run } = reloadIndex();
  const res = await run('纯银项链女高级感', {
    maxLength: 60,
    products: [
      { id: 'p1', title: '银质项链', url: 'https://example/p1', price: 100, stats: { last30DaysSales: 20, goodRates: 0.95, repurchaseRate: 0.3 } },
      { id: 'p2', title: '纯银项链女款', url: 'https://example/p2', price: 120, stats: { last30DaysSales: 12, goodRates: 0.9, repurchaseRate: 0.25 } }
    ]
  });

  // Assertions
  assert.strictEqual(res.coreWord, '项链');
  assert.strictEqual(res.blueOceanWord, '纯银项链女高级感');
  assert.ok(Array.isArray(res.modifiers) && res.modifiers.length === 3);
  assert.strictEqual(res.filteredCount, 2);
  assert.ok(Array.isArray(res.products) && res.products.length === 2);
  // 11 required fields per product (3 new fields added)
  const keys = ['链接原标题', '产品链接', '铺货标题', '商品原价', '30天销量', '好评率', '复购率', '蓝海词', '选品理由', '定价建议', '风险提示'];
  res.products.forEach(p => {
    keys.forEach(k => assert.ok(Object.prototype.hasOwnProperty.call(p, k)));
  });
  assert.ok(Array.isArray(res.titles) && res.titles.length === 3);
});

test('Test 2: Delay between searches', async () => {
  // Delay between dual searches (simulate by delaying searchAll)
  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => {
      await new Promise(r => setTimeout(r, 3500));
      return [
        { id: 'p1', title: '银质项链', url: 'https://example/p1', price: 100, stats: { last30DaysSales: 20, goodRates: 0.95, repurchaseRate: 0.3 } }
      ];
    },
    searchAndFilter: async () => []
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({ coreWord: '项链', modifiers: [{ word: '纯银', rigidity: 'rigid' }] })
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', { searchTaobaoTitles: async () => [] });

  class MockGLMClient2 {
    constructor(config) {}
    async selectAndGenerate({ blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength }) {
      await new Promise(r => setTimeout(r, 3500));
      return {
        selectedProducts: [],
        titles: [
          { productId: products[0] ? products[0].id : 'p1', title: blueOceanWord + ' 版本1' }
        ],
        overallAdvice: ''
      };
    }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient2);

  const { run } = reloadIndex();
  const start = Date.now();
  const keyword = 'delay-keyword-' + Date.now();
  const res = await run(keyword, {
    products: [
      { id: 'p1', title: '银质项链', url: 'https://example/p1', price: 100, stats: { last30DaysSales: 20, goodRates: 0.95, repurchaseRate: 0.3 } }
    ]
  });
  const elapsed = Date.now() - start;

  // Ensure the elapsed time reflects the artificial delay
  assert.ok(elapsed >= 3500);
});

test('Test 3: GLM scoring failure falls back to rigid filtering', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({ coreWord: '项链', modifiers: [{ word: '纯银', rigidity: 'rigid' }] })
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => { throw new Error('GLM failure'); },
    searchAndFilter: async (coreWord, modifiers) => {
      return [
        { id: 'p3', title: '项链银质', url: 'https://example/p3', price: 90, stats: { last30DaysSales: 5, goodRates: 0.8, repurchaseRate: 0.2 } }
      ];
    }
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', { searchTaobaoTitles: async () => [] });

  class MockGLMClient3 {
    constructor(config) {}
    async selectAndGenerate() { throw new Error('GLM failure'); }
    async generateTitles() { return ['蓝海项链 版1']; }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient3);

  const { run } = reloadIndex();
  const res = await run('项链', {
    products: [
      { id: 'p1', title: '项链', url: 'u', price: 50, stats: { last30DaysSales: 1, goodRates: 0.5, repurchaseRate: 0.1 } }
    ]
  });
  assert.ok(Array.isArray(res.products));
});

test('Test 4: Taobao search failure still generates titles', async () => {
  // Make taobao search fail, ensure flow still continues
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({ coreWord: '项链', modifiers: [] })
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => [{ id: 'p1', title: '项链', url: 'u', price: 50, stats: { last30DaysSales: 1, goodRates: 0.5, repurchaseRate: 0.1 } }],
    searchAndFilter: async () => []
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => { throw new Error('taobao fail'); }
  });

  class MockGLMClient4 {
    constructor(config) {}
    async selectAndGenerate() { throw new Error('GLM failure'); }
    async generateTitles() { return ['蓝海词']; }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient4);

  const { run } = reloadIndex();
  const res = await run('项链', {
    products: [
      { id: 'p1', title: '银质项链', url: 'https://a', price: 99, stats: { last30DaysSales: 10, goodRates: 0.9, repurchaseRate: 0.4 } }
    ]
  });
  assert.ok(res && Array.isArray(res.titles));
});

test('Test 5: Empty 1688 search results returns empty array', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({ coreWord: '项链', modifiers: [] })
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => [],
    searchAndFilter: async () => []
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', { searchTaobaoTitles: async () => [] });

  class MockGLMClient5 {
    constructor(config) {}
    async selectAndGenerate() { throw new Error('GLM failure'); }
    async generateTitles() { return []; }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient5);

  const { run } = reloadIndex();
  const res = await run('项链', {});
  assert.strictEqual(res.products.length, 0);
});

test('Test 6: Ensure 11 fields exist in output products when there are results', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({ coreWord: '项链', modifiers: [{ word: '纯银', rigidity: 'rigid' }] })
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => [
      { id: 'p1', title: '银质项链', url: 'https://a', price: 99, stats: { last30DaysSales: 10, goodRates: 0.9, repurchaseRate: 0.4 } }
    ],
    searchAndFilter: async () => []
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', { searchTaobaoTitles: async () => [] });

  class MockGLMClient6 {
    constructor(config) {}
    async selectAndGenerate({ blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength }) {
      return {
        selectedProducts: [],
        titles: [
          { productId: products[0] ? products[0].id : 'p1', title: blueOceanWord + ' 版1' }
        ],
        overallAdvice: ''
      };
    }
    async generateTitles() { return ['蓝海项链 版1']; }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient6);

  const { run } = reloadIndex();
  const res = await run('necklace', {
    products: [
      { id: 'p1', title: 'necklace', url: 'https://a', price: 99, stats: { last30DaysSales: 10, goodRates: 0.9, repurchaseRate: 0.4 } }
    ]
  });
  const first = res.products[0];
  assert.ok('链接原标题' in first);
  assert.ok('产品链接' in first);
  assert.ok('铺货标题' in first);
  assert.ok('商品原价' in first);
  assert.ok('30天销量' in first);
  assert.ok('好评率' in first);
  assert.ok('复购率' in first);
  assert.ok('蓝海词' in first);
  assert.ok('选品理由' in first);
  assert.ok('定价建议' in first);
  assert.ok('风险提示' in first);
});

test('hashProducts ignores volatile price changes when product ids are stable', () => {
  const { hashProducts } = require('../src/pipeline');
  const first = hashProducts([
    { id: '1001', title: '陶瓷摆件 招财猫', price: '9.90', sales: '100+' },
    { offerId: '1002', title: '陶瓷摆件 小花瓶', price: '12.30', sales: '200+' }
  ]);
  const second = hashProducts([
    { id: '1001', title: '陶瓷摆件 招财猫', price: '10.10', sales: '130+' },
    { offerId: '1002', title: '陶瓷摆件 小花瓶', price: '11.80', sales: '240+' }
  ]);

  assert.equal(first, second);
});

test('run limits concurrent selectAndGenerate batches', async () => {
  const { run } = require('../src');
  let active = 0;
  let maxActive = 0;
  const products = Array.from({ length: 45 }, (_, index) => ({
    id: `offer-${index}`,
    title: `陶瓷摆件 商品 ${index}`,
    url: `https://detail.1688.com/offer/${100000 + index}.html`
  }));

  const glmClient = {
    async selectAndGenerate() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return {
        selectedProducts: [],
        titles: [{ title: '陶瓷摆件 家用桌面装饰创意小摆件客厅玄关装饰品' }]
      };
    },
    async generateTitles() {
      return ['陶瓷摆件 家用桌面装饰创意小摆件客厅玄关装饰品'];
    }
  };

  await run(`陶瓷摆件-${Date.now()}`, {
    products,
    peerTitles: ['陶瓷摆件 家用桌面装饰'],
    coreWord: '摆件',
    modifiers: [{ word: '陶瓷', type: 'rigid' }],
    glmClient,
    llmConcurrency: 2,
    runTimeoutMs: 10000,
    silent: true
  });

  assert.ok(maxActive <= 2);
  assert.ok(maxActive > 0);
});

test('computeEffectiveRunTimeout expands when image search is enabled', () => {
  const { computeEffectiveRunTimeout } = require('../src');
  assert.equal(computeEffectiveRunTimeout({ runTimeoutMs: 120000, useImageSearch: false, maxImageSearch: 10, productCount: 10 }), 120000);
  assert.equal(computeEffectiveRunTimeout({ runTimeoutMs: 120000, useImageSearch: true, maxImageSearch: 4, productCount: 10 }), 160000);
  assert.equal(computeEffectiveRunTimeout({ runTimeoutMs: 60000, useImageSearch: true, maxImageSearch: 0, productCount: 3 }), 135000);
});

test('run can return non-distributable generic titles when no 1688 products exist', async () => {
  const { run } = require('../src');
  const glmClient = {
    async generateTitles() {
      return ['陶瓷摆件 桌面装饰家居客厅玄关创意小摆件礼品'];
    }
  };

  const result = await run(`陶瓷摆件-${Date.now()}`, {
    products: [],
    peerTitles: ['陶瓷摆件 家居桌面装饰'],
    allowGenericTitlesWhenNoProducts: true,
    coreWord: '摆件',
    modifiers: [{ word: '陶瓷', type: 'rigid' }],
    glmClient,
    silent: true
  });

  assert.equal(result.status, 'no_products_fallback_titles');
  assert.equal(result.canDistribute, false);
  assert.equal(result.products.length, 0);
  assert.ok(result.titles.length > 0);
  assert.deepEqual(result.modifiers, [{ word: '陶瓷', type: 'rigid' }]);
  assert.deepEqual(result.stats.modifiers, ['陶瓷']);
});
