const { test, describe, mock } = require('node:test');
const assert = require('node:assert');
const GLMClient = require('../glm-client');

describe('GLMClient.judgeRelevance', () => {
  const mockApiKey = 'test-api-key';
  const client = new GLMClient({ apiKey: mockApiKey });

  test('Test 1: judgeRelevance returns product score list', async () => {
    // Mock axios.post to return valid scoring response
    const mockResponse = {
      data: {
        choices: [{
          message: {
            content: JSON.stringify([
              { productId: 'p1', score: 8, reason: '完全匹配' },
              { productId: 'p2', score: 5, reason: '部分匹配' }
            ])
          }
        }]
      }
    };

    // Temporarily replace axios.post
    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = mock.fn(() => Promise.resolve(mockResponse));

    try {
      const result = await client.judgeRelevance({
        blueOceanWord: '纯银项链',
        coreWord: '项链',
        products: [
          { id: 'p1', title: '纯银项链女款', price: 100, sales: 50 },
          { id: 'p2', title: '金项链', price: 200, sales: 30 }
        ]
      });

      assert.ok(Array.isArray(result), 'Result should be an array');
      assert.strictEqual(result.length, 2, 'Should return scores for 2 products');
      assert.ok(result[0].productId, 'First item should have productId');
      assert.strictEqual(typeof result[0].score, 'number', 'Score should be a number');
      assert.ok(result[0].reason, 'First item should have reason');
    } finally {
      axios.post = originalPost;
    }
  });

  test('Test 2: Score ≥6 marks product as relevant', async () => {
    const mockResponse = {
      data: {
        choices: [{
          message: {
            content: JSON.stringify([
              { productId: 'p1', score: 8, reason: '高度相关' },
              { productId: 'p2', score: 6, reason: '基本相关' },
              { productId: 'p3', score: 5, reason: '不太相关' }
            ])
          }
        }]
      }
    };

    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = mock.fn(() => Promise.resolve(mockResponse));

    try {
      const result = await client.judgeRelevance({
        blueOceanWord: '纯银项链',
        coreWord: '项链',
        products: [
          { id: 'p1', title: '纯银项链', price: 100 },
          { id: 'p2', title: '纯银项链女', price: 120 },
          { id: 'p3', title: '金项链', price: 200 }
        ]
      });

      const relevantProducts = result.filter(r => r.score >= 6);
      assert.strictEqual(relevantProducts.length, 2, 'Products with score >=6 should be relevant');
      assert.ok(relevantProducts.some(r => r.productId === 'p1'), 'p1 should be relevant');
      assert.ok(relevantProducts.some(r => r.productId === 'p2'), 'p2 should be relevant');
      assert.ok(!relevantProducts.some(r => r.productId === 'p3'), 'p3 should not be relevant');
    } finally {
      axios.post = originalPost;
    }
  });

  test('Test 3: Batch scoring limits to max 15 products', async () => {
    const axios = require('axios');
    const originalPost = axios.post;
    let capturedProducts;
    
    axios.post = mock.fn((url, data) => {
      // Capture the products sent in the request (using Chinese key)
      const content = JSON.parse(data.messages[1].content);
      capturedProducts = content['产品列表'];
      
      const mockScores = capturedProducts.map((p) => ({
        productId: p.id,
        score: 7,
        reason: '测试'
      }));
      
      return Promise.resolve({
        data: {
          choices: [{
            message: { content: JSON.stringify(mockScores) }
          }]
        }
      });
    });

    try {
      // Create 20 products
      const products = Array.from({ length: 20 }, (_, i) => ({
        id: `p${i + 1}`,
        title: `商品${i + 1}`,
        price: 100 + i
      }));

      await client.judgeRelevance({
        blueOceanWord: '测试',
        coreWord: '测试',
        products,
        maxProducts: 15
      });

      assert.strictEqual(capturedProducts.length, 15, 'Should only send 15 products to GLM');
    } finally {
      axios.post = originalPost;
    }
  });

  test('Test 4: GLM API failure throws error (caller handles fallback)', async () => {
    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = mock.fn(() => Promise.reject(new Error('Network error')));

    try {
      await client.judgeRelevance({
        blueOceanWord: '测试',
        coreWord: '测试',
        products: [{ id: 'p1', title: '商品1', price: 100 }]
      });
      
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.ok(err instanceof Error, 'Should throw an Error');
      assert.ok(err.message.includes('Network') || err.message.includes('API'), 'Error message should indicate API failure');
    } finally {
      axios.post = originalPost;
    }
  });

  test('Test 5: Invalid JSON response throws error', async () => {
    const mockResponse = {
      data: {
        choices: [{
          message: {
            content: 'not valid json'
          }
        }]
      }
    };

    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = mock.fn(() => Promise.resolve(mockResponse));

    try {
      await client.judgeRelevance({
        blueOceanWord: '测试',
        coreWord: '测试',
        products: [{ id: 'p1', title: '商品1', price: 100 }]
      });
      
      assert.fail('Should have thrown an error for invalid JSON');
    } catch (err) {
      assert.ok(err instanceof Error, 'Should throw an Error');
      assert.ok(err.message.includes('JSON') || err instanceof SyntaxError, 'Error should be related to JSON parsing');
    } finally {
      axios.post = originalPost;
    }
  });
});

describe('GLMClient.selectAndGenerate', () => {
  const mockApiKey = 'test-api-key';
  const client = new GLMClient({ apiKey: mockApiKey });

  test('Test 1: selectAndGenerate returns selectedProducts and titles with fields', async () => {
    const mockResponse = {
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              selectedProducts: [
                {
                  id: 'p1', score: 9, reason: '很好', priceAdvice: '建议价格', risk: '低'
                }
              ],
              titles: [ { productId: 'p1', title: '标题1' } ],
              overallAdvice: 'OK'
            })
          }
        }]
      }
    };

    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = mock.fn(() => Promise.resolve(mockResponse));

    try {
      const res = await client.selectAndGenerate({
        blueOceanWord: '蓝海',
        coreWord: '核心',
        modifiers: [{ word: '修饰', rigidity: 'rigid' }],
        peerTitles: [],
        products: [{ id: 'p1', title: '商品1', price: 100 }],
        maxLength: 60
      });

      // 验证返回结构与字段
      assert.ok(res.selectedProducts && res.selectedProducts.length === 1, 'should return one selectedProduct');
      const sp = res.selectedProducts[0];
      assert.strictEqual(sp.id, 'p1');
      assert.ok(typeof sp.score === 'number');
      assert.ok('priceAdvice' in sp);
      assert.ok('risk' in sp);
      assert.ok(res.titles && res.titles.length > 0);
      assert.strictEqual(res.titles[0].productId, 'p1');
    } finally {
      axios.post = originalPost;
    }
  });

  test('Test 2: selectAndGenerate returns titles mapping for multiple products', async () => {
    const mockResponse = {
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              selectedProducts: [
                { id: 'p1', score: 8, reason: '相关', priceAdvice: '', risk: '' }
              ],
              titles: [ { productId: 'p1', title: '标题A' }, { productId: 'p2', title: '标题B' } ],
              overallAdvice: 'OK'
            })
          }
        }]
      }
    };

    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = mock.fn(() => Promise.resolve(mockResponse));

    try {
      const res = await client.selectAndGenerate({
        blueOceanWord: '蓝海',
        coreWord: '核心',
        modifiers: [{ word: '修饰', rigidity: 'rust' }],
        peerTitles: [],
        products: [{ id: 'p1', title: '商品1', price: 100 }, { id: 'p2', title: '商品2', price: 120 }],
        maxLength: 60
      });

      assert.ok(res.titles && res.titles.length === 2);
      assert.strictEqual(res.titles[0].productId, 'p1');
      assert.strictEqual(res.titles[0].title, '标题A');
      assert.strictEqual(res.titles[1].productId, 'p2');
      assert.strictEqual(res.titles[1].title, '标题B');
    } finally {
      axios.post = originalPost;
    }
  });

  test('Test 3: selectAndGenerate uses 30s timeout', async () => {
    const mockResponse = {
      data: {
        choices: [{
          message: {
            content: JSON.stringify({ selectedProducts: [], titles: [], overallAdvice: '' })
          }
        }]
      }
    };

    const axios = require('axios');
    const originalPost = axios.post;
    let capturedConfig;
    axios.post = mock.fn((url, data, config) => {
      capturedConfig = config;
      return Promise.resolve(mockResponse);
    });

    try {
      await client.selectAndGenerate({
        blueOceanWord: '蓝海',
        coreWord: '核心',
        modifiers: [],
        peerTitles: [],
        products: [],
        maxLength: 60
      });
      assert.ok(capturedConfig && capturedConfig.timeout === 30000, 'timeout should be 30000ms');
    } finally {
      axios.post = originalPost;
    }
  });
});
