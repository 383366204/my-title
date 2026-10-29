const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readImageUploadState } = require('../../../../skills/peer-discovery/src/image-upload-state');
const { uploadTimeoutMessage, isUploadReady } = require('../../../../skills/peer-discovery/src/image-search-provider');

test('upload diagnostics distinguish missing observation, file rejection and uncertain completion', () => {
  assert.match(uploadTimeoutMessage(null), /无法读取/);
  assert.match(uploadTimeoutMessage({ fileCount: 0 }), /状态无法确认/);
  assert.match(uploadTimeoutMessage({ fileCount: 1, uploaded: false }), /状态无法确认/);
  assert.match(uploadTimeoutMessage({ fileCount: 1, uploaded: true, previewReady: true, buttonReady: false }), /搜索按钮尚不可用/);
});

test('serialized page reader waits for preview and only clicks the upload panel search', () => {
  let clicks = 0;
  const visible = { getBoundingClientRect: () => ({ height: 20 }) };
  const image = { ...visible, complete: false, naturalWidth: 0 };
  const button = { ...visible, textContent: '搜索', getAttribute: () => null, click: () => { clicks++; } };
  const panel = { querySelectorAll: selector => selector === 'img' ? [image] : [button] };
  const marker = { ...visible, children: [], textContent: '已上传 1 张图', parentElement: panel };
  const context = { document: { body: {}, querySelector: () => ({ files: [] }), querySelectorAll: () => [marker] }, getComputedStyle: () => ({ visibility: 'visible' }) };
  const evaluate = () => vm.runInNewContext(`(${readImageUploadState.toString()})(true)`, context);
  assert.equal(evaluate().clicked, undefined);
  assert.equal(clicks, 0);
  image.complete = true; image.naturalWidth = 100;
  assert.equal(evaluate().clicked, true);
  assert.equal(clicks, 1);
  button.disabled = true;
  assert.equal(evaluate().clicked, undefined);
  assert.equal(clicks, 1);
});

test('completed uploads remain ready after the file input is cleared', () => {
  assert.equal(isUploadReady({ fileCount: 0, uploaded: true, previewReady: true, buttonReady: true }), true);
  assert.equal(isUploadReady({ fileCount: 1, uploaded: false, buttonReady: true }), false);
  assert.equal(isUploadReady({ uploaded: true, previewReady: true, buttonReady: false }), false);
  assert.equal(isUploadReady({ uploaded: true, previewReady: true, buttonReady: true, error: '上传失败' }), false);
});
