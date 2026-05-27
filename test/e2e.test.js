"use strict";
const { test } = require('node:test');
const assert = require('assert');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveProjectModulePath(modulePath) {
  const normalized = modulePath.replace(/\\/g, '/');
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
  const idxPath = require.resolve('../skills/title-gen/src/index.js');
  const llmPath = require.resolve('../core/llm');
  delete require.cache[idxPath];
  delete require.cache[llmPath];
  return require('../skills/title-gen/src/index.js');
}

/**
 * Test 1: Complete happy path
 * - Mock all dependencies (GLM extract, 1688 search, GLM score, taobao search, GLM generate)
 * - Call run("纯银项链女高级感", {format: 'both'})
 * - Verify: returns coreWord, blueOceanWord, products array with 8 fields, titles start with blue ocean keyword
 */
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

  // Mock search-1688.js
  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => {
      return [
        { 
          id: 'p1', 
          title: 'S925纯银项链女锁骨链', 
          url: 'https://example.com/p1', 
          price: 45.00, 
          stats: { last30DaysSales: 500, goodRates: 0.98, repurchaseRate: 0.35 } 
        },
        { 
          id: 'p2', 
          title: '纯银项链女款高级感', 
          url: 'https://example.com/p2', 
          price: 68.00, 
          stats: { last30DaysSales: 300, goodRates: 0.95, repurchaseRate: 0.28 } 
        }
      ];
    },
    searchAndFilter: async () => []
  });

  // Mock search-taobao.js
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => ['纯银项链女轻奢小众', 'S925银项链女高级感']
  });

  // Mock glm-client.js
  class MockGLMClient1 {
    constructor(config) {}
    async selectAndGenerate({ blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength }) {
      return {
        selectedProducts: [
          { id: 'p1', score: 9, reason: '理由1', priceAdvice: '定价1', risk: '风险1' },
          { id: 'p2', score: 8, reason: '理由2', priceAdvice: '定价2', risk: '风险2' }
        ],
        titles: [
          { productId: 'p1', title: `${blueOceanWord} 版本1` },
          { productId: 'p2', title: `${blueOceanWord} 版本2` },
          { productId: 'p3', title: `${blueOceanWord} 版本3` }
        ],
        overallAdvice: ''
      };
    }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient1);

  const { run } = reloadIndex();
  const result = await run('纯银项链女高级感', {
    maxLength: 60,
    products: [
      { id: 'p1', title: '银质项链', url: 'https://example.com/p1', price: 100.00, stats: { last30DaysSales: 100, goodRates: 0.95, repurchaseRate: 0.3 } },
      { id: 'p2', title: '纯银项链女款', url: 'https://example.com/p2', price: 120.00, stats: { last30DaysSales: 80, goodRates: 0.92, repurchaseRate: 0.25 } }
    ]
  });

  // Verify coreWord and blueOceanWord
  assert.strictEqual(result.coreWord, '项链');
  assert.strictEqual(result.blueOceanWord, '纯银项链女高级感');

  // Verify modifiers
  assert.ok(Array.isArray(result.modifiers));
  assert.strictEqual(result.modifiers.length, 3);

  // Verify products array
  assert.ok(Array.isArray(result.products));
  assert.strictEqual(result.products.length, 2);
  assert.strictEqual(result.filteredCount, 2);

  // Verify 8 required fields per product
  const requiredFields = ['链接原标题', '产品链接', '铺货标题', '商品原价', '30天销量', '好评率', '复购率', '蓝海词'];
  result.products.forEach(p => {
    requiredFields.forEach(field => {
      assert.ok(Object.prototype.hasOwnProperty.call(p, field), `Missing field: ${field}`);
    });
  });

  // Verify titles start with blue ocean keyword
  assert.ok(Array.isArray(result.titles));
  assert.ok(result.titles.length > 0);
  result.titles.forEach(title => {
    assert.ok(title.startsWith('纯银项链女高级感'), `Title should start with blue ocean keyword: ${title}`);
  });
});

/**
 * Test 2: Empty 1688 search results
 * - Mock 1688 search to return empty array
 * - Verify: returns empty products array gracefully
 */
test('Test 2: Empty 1688 search results', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({
      coreWord: '项链',
      modifiers: [{ word: '纯银', rigidity: 'rigid' }]
    })
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => [],
    searchAndFilter: async () => []
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => []
  });

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
  const result = await run('纯银项链', { maxLength: 60 });

  // Verify empty products array
  assert.ok(Array.isArray(result.products));
  assert.strictEqual(result.products.length, 0);
  assert.strictEqual(result.filteredCount, 0);
  assert.ok(Array.isArray(result.titles));
  assert.strictEqual(result.titles.length, 0);
});

/**
 * Test 3: GLM scoring failure fallback
 * - Mock GLM judgeRelevance to throw error
 * - Verify: still returns results using rigid modifier filtering fallback
 */
test('Test 3: GLM scoring failure fallback', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({
      coreWord: '项链',
      modifiers: [
        { word: '纯银', rigidity: 'rigid' },
        { word: '女', rigidity: 'rigid' }
      ]
    })
  });

  // searchAll throws error, fallback to searchAndFilter
  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => { throw new Error('GLM scoring API failure'); },
    searchAndFilter: async (coreWord, modifiers) => {
      // Fallback returns products based on rigid modifier filtering
      return [
        { 
          id: 'p1', 
          title: '纯银项链女款', 
          url: 'https://example.com/p1', 
          price: 55.00, 
          stats: { last30DaysSales: 200, goodRates: 0.96, repurchaseRate: 0.30 } 
        }
      ];
    }
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => []
  });

  class MockGLMClient3 {
    constructor(config) {}
    async selectAndGenerate() { throw new Error('GLM failure'); }
    async generateTitles() { return ['纯银项链女款 高级感']; }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient3);

  const { run } = reloadIndex();
  const result = await run('纯银项链女', {
    maxLength: 60,
    products: [
      { id: 'p1', title: '纯银项链女款', url: 'https://example.com/p1', price: 55.00, stats: { last30DaysSales: 200, goodRates: 0.96, repurchaseRate: 0.30 } }
    ]
  });

  // Verify fallback still returns results
  assert.ok(Array.isArray(result.products));
  assert.strictEqual(result.products.length, 1);
  assert.strictEqual(result.filteredCount, 1);
  assert.ok(Array.isArray(result.titles));
  assert.ok(result.titles.length >= 1);
});

/**
 * Test 4: Taobao search failure
 * - Mock searchTaobaoTitles to throw error
 * - Verify: still generates titles without peer titles
 */
test('Test 4: Taobao search failure', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({
      coreWord: '项链',
      modifiers: [{ word: '纯银', rigidity: 'rigid' }]
    })
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => [
      { 
        id: 'p1', 
        title: '纯银项链', 
        url: 'https://example.com/p1', 
        price: 50.00, 
        stats: { last30DaysSales: 100, goodRates: 0.9, repurchaseRate: 0.2 } 
      }
    ],
    searchAndFilter: async () => []
  });

  // Taobao search fails
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => { throw new Error('Taobao search failed'); }
  });

  class MockGLMClient4 {
    constructor(config) {}
    async selectAndGenerate() { throw new Error('GLM failure'); }
    async generateTitles({ peerTitles }) {
      // Verify peerTitles is empty array when taobao fails
      assert.ok(Array.isArray(peerTitles));
      assert.strictEqual(peerTitles.length, 0);
      return ['纯银项链 女款 高级感'];
    }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient4);

  const { run } = reloadIndex();
  const result = await run('纯银项链', {
    maxLength: 60,
    products: [
      { id: 'p1', title: '纯银项链', url: 'https://example.com/p1', price: 50.00, stats: { last30DaysSales: 100, goodRates: 0.9, repurchaseRate: 0.2 } }
    ]
  });

  // Verify titles are still generated without peer titles
  assert.ok(Array.isArray(result.titles));
  assert.ok(result.titles.length >= 1);
  assert.ok(result.titles[0].includes('纯银项链'));
});

/**
 * Test 5: All external dependencies fail
 * - Mock all external calls to fail
 * - Verify: returns meaningful error or empty result (not crash)
 */
test('Test 5: All external dependencies fail', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async () => { throw new Error('GLM extract failed'); }
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => { throw new Error('1688 search failed'); },
    searchAndFilter: async () => { throw new Error('1688 filter failed'); }
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => { throw new Error('Taobao search failed'); }
  });

  class MockGLMClient5 {
    constructor(config) {}
    async selectAndGenerate() { throw new Error('GLM failure'); }
    async generateTitles() { throw new Error('GLM generate failed'); }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient5);

  const { run } = reloadIndex();

  // Should not crash, should either return empty result or throw meaningful error
  try {
    const result = await run('纯银项链', { maxLength: 60 });
    // If no error thrown, verify we get some result structure
    assert.ok(result);
    assert.ok(typeof result === 'object');
  } catch (error) {
    // If error is thrown, verify it's meaningful (not undefined or empty)
    assert.ok(error.message);
    assert.ok(error.message.length > 0);
  }
});

/**
 * Test 6: Format switching
 * - Test with format='table', format='json', format='both'
 * - Verify: output format matches requested format
 */
test('Test 6: Format switching', async () => {
  mockModule('/mnt/d/project/my-title/skills/title-gen/src/extract-core.js', {
    extractCoreAndModifiers: async (input) => ({
      coreWord: '项链',
      modifiers: [{ word: '纯银', rigidity: 'rigid' }]
    })
  });

  mockModule('/mnt/d/project/my-title/skills/alibaba1688/src/search-1688.js', {
    searchAll: async () => [
      { 
        id: 'p1', 
        title: '纯银项链', 
        url: 'https://example.com/p1', 
        price: 50.00, 
        stats: { last30DaysSales: 100, goodRates: 0.9, repurchaseRate: 0.2 } 
      }
    ],
    searchAndFilter: async () => []
  });

  mockModule('/mnt/d/project/my-title/skills/title-gen/src/search-taobao.js', {
    searchTaobaoTitles: async () => []
  });

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
    async generateTitles() { return ['纯银项链 女款']; }
  }
  mockModule('/mnt/d/project/my-title/core/glm-client.js', MockGLMClient6);

  const { formatResult } = require('../skills/title-gen/src/output-formatter');

  // Create a sample result to test format switching
  const sampleProducts = [
    {
      '链接原标题': '纯银项链',
      '产品链接': 'https://example.com/p1',
      '铺货标题': '纯银项链',
      '商品原价': 50.00,
      '30天销量': 100,
      '好评率': 0.9,
      '复购率': 0.2,
      '蓝海词': '纯银项链'
    }
  ];

  // Test format='table'
  const tableOutput = formatResult(sampleProducts, 'table');
  assert.ok(typeof tableOutput === 'string');
  assert.ok(tableOutput.includes('纯银项链') || tableOutput.includes('产品'));

  // Test format='json'
  const jsonOutput = formatResult(sampleProducts, 'json');
  assert.ok(typeof jsonOutput === 'string');
  const parsed = JSON.parse(jsonOutput);
  assert.ok(Array.isArray(parsed));
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0]['蓝海词'], '纯银项链');

  // Test format='both'
  const bothOutput = formatResult(sampleProducts, 'both');
  assert.ok(typeof bothOutput === 'string');
  // Both should contain table-like and JSON-like content
  assert.ok(bothOutput.length > 0);
});
