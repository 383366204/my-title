'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initRun, appendJsonl, readJsonl } = require('../../../../skills/pipeline-flow/src/run-store');
const { flowSelectProducts } = require('../../../../skills/pipeline-flow/src/product-selection-flow');
const { flowReviewProducts } = require('../../../../skills/pipeline-flow/src/manual-flow');
const { productTitle } = require('../../../../skills/pipeline-flow/src/product-normalizer');

test('failed queries retain diagnostic records, realistic progress and cannot be approved as products', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-search-failed-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const options = { dataDir, runId: 'failed-search' };
  const { run } = initRun(options);
  appendJsonl(run.files.verifiedKeywords, [{ keyword: '收纳盒' }, { keyword: '杯垫' }]);
  const progress = [];
  const result = await flowSelectProducts({ ...options, includeReviewKeywords: true, limit: Number.MAX_SAFE_INTEGER,
    extractKeywords: async () => ({ coreWord: '收纳盒' }),
    searchProducts: async () => { throw Object.assign(new Error('Request failed with status code 502'), { response: { status: 502 } }); },
    onProgress: event => progress.push(event)
  });
  assert.equal(result.status, 'select_failed');
  assert.ok(result.selected.every(row => row.failureStage === 'search' && row.httpStatus === 502));
  assert.equal(progress.at(-1).total, 2);
  assert.equal(progress.at(-1).current, 2);
  assert.throws(() => flowReviewProducts({ ...options, approvedProductIds: ['0'] }), /不是商品/);
  assert.equal(readJsonl(run.files.selectedProducts).length, 2);
  assert.equal(productTitle({ '链接原标题': '真实商品标题' }), '真实商品标题');
  const recovered = await flowSelectProducts({ ...options, includeReviewKeywords: true, limit: 1,
    extractKeywords: async () => ({ coreWord: '收纳盒' }),
    searchProducts: async () => [{ offerId: '123', '链接原标题': '真实商品标题', categoryName: '桌面收纳' }]
  });
  assert.equal(recovered.evaluated[0].sourceTitle, '真实商品标题');
  assert.equal(recovered.evaluated[0].recommendedCategory, '桌面收纳');
});
