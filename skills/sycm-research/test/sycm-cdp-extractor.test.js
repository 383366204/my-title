const assert = require('assert');
const { test } = require('node:test');

const { classifySycmError } = require('../src/sycm-cdp-extractor');

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
