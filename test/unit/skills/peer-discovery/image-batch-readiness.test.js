const { test } = require('node:test');
const assert = require('node:assert/strict');
const { imageBatchReadiness } = require('../../../../skills/peer-discovery/src/image-search-provider');

test('image batch waits for loaded images and four unchanged observations', () => {
  const row = { renderKey: 'offer_123', title: '商品', displayPrice: '¥10', imageUrl: 'https://img.alicdn.com/1.jpg', imageReady: false };
  let state = {};
  for (let i = 0; i < 5; i++) state = imageBatchReadiness([row], state);
  assert.equal(state.ready, false);
  row.imageReady = true;
  for (let i = 0; i < 3; i++) {
    state = imageBatchReadiness([row], state);
    assert.equal(state.ready, false);
  }
  state = imageBatchReadiness([row], state);
  assert.equal(state.ready, true);
  assert.equal(imageBatchReadiness([{ ...row, displayPrice: '¥11' }], state).ready, false);
  assert.equal(imageBatchReadiness([], state).ready, false);
});
