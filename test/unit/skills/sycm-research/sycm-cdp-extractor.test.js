const assert = require('assert');
const { test } = require('node:test');

const { classifySycmError, normalizeSycmFilterConditions, _applyFilterConditions } = require('../../../../skills/sycm-research/src/sycm-cdp-extractor');

test('classifySycmError detects login blocker', () => {
  const err = new Error('请先登录千牛或生意参谋');
  assert.equal(classifySycmError(err).status, 'login_required');
});

test('classifySycmError detects slider blocker', () => {
  const err = new Error('页面出现滑块验证');
  assert.equal(classifySycmError(err).status, 'slider_required');
});

test('classifySycmError detects feature permission blocker', () => {
  const err = new Error('该功能未开通或无权限访问');
  assert.equal(classifySycmError(err).status, 'sycm_feature_required');
});

test('SYCM filters normalize all five fields and reject invalid numbers', () => {
  assert.deepEqual(normalizeSycmFilterConditions({ searchPopularity: 50, conversionRate: 1 }), {
    demandSupplyRatio: 0, searchPopularity: 50, conversionRate: 1, buyerCount: 0, referencePrice: 0
  });
  for (const conditions of [{ searchPopularity: -1 }, { conversionRate: 101 }, { buyerCount: 'bad' }]) {
    assert.throws(() => normalizeSycmFilterConditions(conditions), /Invalid SYCM filter/);
  }
});

test('SYCM applies active filters and clears all unused fields', async t => {
  t.mock.method(global, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  const fields = [];
  const cdp = {
    evaluate: async () => 'found',
    runAction: async script => {
      if (script.includes('nativeSetter.call')) {
        fields.push(script.match(/nativeSetter.call\(input, '([^']*)'\)/)[1]);
        return 'filled:field';
      }
      return script.includes('confirm_not_found') ? 'confirmed' : 'clicked';
    }
  };
  assert.equal(await _applyFilterConditions(cdp, { searchPopularity: 50 }, () => {}), true);
  assert.deepEqual(fields, ['', '50', '', '', '']);
  cdp.runAction = async script => script.includes('nativeSetter.call') ? 'filled:field' : script.includes('confirm_not_found') ? 'confirm_not_found' : 'clicked';
  assert.equal(await _applyFilterConditions(cdp, {}, () => {}), false);
});
