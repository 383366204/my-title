const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mockProducts, mockSearchResponse, MockAlibaba1688Client } = require('./helpers/mock-data');

describe('Test Framework Setup', () => {
  it('should load mock data module', () => {
    assert.ok(mockProducts, 'mockProducts should be defined');
    assert.ok(Array.isArray(mockProducts), 'mockProducts should be an array');
    assert.ok(mockProducts.length > 0, 'mockProducts should have items');
  });

  it('should have valid product structure', () => {
    const product = mockProducts[0];
    assert.ok(product.productId, 'product should have productId');
    assert.ok(product.title, 'product should have title');
    assert.ok(typeof product.saleCount === 'number', 'product should have numeric saleCount');
    assert.ok(product.attributes, 'product should have attributes');
  });

  it('should have stats fields in products', () => {
    mockProducts.forEach(product => {
      assert.ok('saleCount' in product, 'product should have saleCount');
      assert.ok('imageUrl' in product, 'product should have imageUrl');
      assert.ok('images' in product, 'product should have images array');
    });
  });

  it('should have mock search response with total', () => {
    assert.ok(mockSearchResponse.data, 'response should have data');
    assert.ok(mockSearchResponse.data.total, 'response should have total');
    assert.strictEqual(mockSearchResponse.data.products.length, mockSearchResponse.data.total);
  });

  it('should create mock client instance', () => {
    const client = new MockAlibaba1688Client();
    assert.ok(client, 'client should be created');
    assert.ok(typeof client.searchProducts === 'function', 'client should have searchProducts method');
  });

  it('should return mock products on search', async () => {
    const client = new MockAlibaba1688Client();
    const result = await client.searchProducts('项链');
    assert.strictEqual(result.code, 200);
    assert.ok(Array.isArray(result.data.products));
  });

  it('should simulate failure when configured', async () => {
    const client = new MockAlibaba1688Client({ fail: true });
    await assert.rejects(
      async () => client.searchProducts('test'),
      /Mock API failure/
    );
  });
});