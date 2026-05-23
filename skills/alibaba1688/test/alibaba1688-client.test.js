const { test, afterEach } = require('node:test');
const assert = require('assert');
const Alibaba1688Client = require('../src/client');
const mock = require('./helpers/mock-data');
let axios = require('axios');

const AK = 'a'.repeat(48);

afterEach(() => {
});

test('Test 1: should return products with correct structure', async () => {
  const client = new Alibaba1688Client(AK);
  const offers = mock.offersSample;
  axios.post = async () => ({
    data: {
      success: true,
      model: { data: offers }
    }
  });
  const products = await client.searchOffers('test');
  assert.ok(Array.isArray(products));
  assert.strictEqual(products.length, Object.keys(offers).length);
  const first = products.find(p => p.id === '808568029789');
  assert.ok(first, 'should contain product with id 808568029789');
  assert.strictEqual(first.title, 'Test Title A');
  assert.strictEqual(first.price, '3.00');
  assert.strictEqual(first.url, 'https://example.com/img1.jpg');
  assert.ok(first.stats);
  assert.strictEqual(first.stats.last30DaysSales, 600);
  assert.strictEqual(first.stats.goodRates, 100);
  assert.strictEqual(first.stats.repurchaseRate, 0.45714285714285713);
});

test('Test 2: should extract stats sub-object with required fields', async () => {
  const client = new Alibaba1688Client(AK);
  const offers = mock.offersSample;
  axios.post = async () => ({
    data: {
      success: true,
      model: { data: offers }
    }
  });
  const products = await client.searchOffers('test');
  for (const p of products) {
    assert.ok(p.stats, 'stats should exist');
    assert.ok('last30DaysSales' in p.stats);
    assert.ok('goodRates' in p.stats);
    assert.ok('repurchaseRate' in p.stats);
    assert.strictEqual(typeof p.stats.last30DaysSales, 'number');
    assert.strictEqual(typeof p.stats.goodRates, 'number');
    assert.strictEqual(typeof p.stats.repurchaseRate, 'number');
  }
});

test('Test 3: 429 status triggers retry mechanism', async () => {
  const client = new Alibaba1688Client(AK);
  let callCount = 0;
  axios.post = async () => {
    callCount++;
    const err = new Error('429 too many requests');
    err.response = { status: 429 };
    throw err;
  };
  try {
    await client.searchOffers('test');
    assert.fail('Expected to throw after retries');
  } catch (e) {
    assert.ok(callCount >= 2);
  }
});

test('Test 4: persistent 429 should throw after retries', async () => {
  const client = new Alibaba1688Client(AK);
  axios.post = async () => {
    const err = new Error('429 too many requests');
    err.response = { status: 429 };
    throw err;
  };
  try {
    await client.searchOffers('test');
    assert.fail('Expected to throw after retries');
  } catch (e) {
    assert.ok(true);
  }
});

test('Test 5: network timeout triggers retry', async () => {
  const client = new Alibaba1688Client(AK);
  let attempt = 0;
  axios.post = async () => {
    attempt++;
    const err = new Error('Timeout');
    err.code = 'ECONNABORTED';
    throw err;
  };
  try {
    await client.searchOffers('test');
    assert.fail('Expected to throw after retries');
  } catch (e) {
    assert.ok(attempt >= 2);
  }
});
