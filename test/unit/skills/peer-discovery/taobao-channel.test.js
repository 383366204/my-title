'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTaobaoChannel } = require('../../../../skills/peer-discovery/src/taobao-channel');
const { normalizePeerDiscoveryParams } = require('../../../../skills/peer-discovery/src/params');
const ready = { status: 'ready', operations: { productDetail: true, imageSearch: true, shopSales: true } };

test('auto prefers native while explicit web stays web', () => {
  const probes = { native: ready, web: ready };
  assert.equal(resolveTaobaoChannel({ probes }).channel, 'native');
  assert.equal(resolveTaobaoChannel({ requested: 'web', probes }).channel, 'web');
  assert.equal(normalizePeerDiscoveryParams().taobaoChannel, 'auto');
  assert.equal(normalizePeerDiscoveryParams({ taobaoChannel: 'web' }).taobaoChannel, 'web');
  assert.throws(() => normalizePeerDiscoveryParams({ taobaoChannel: 'cdp' }), /采集方式/);
});

test('missing capability requires confirmation and a homepage alone is not readiness', () => {
  assert.equal(resolveTaobaoChannel({ probes: { native: { status: 'unavailable' }, web: ready } }).status, 'switch_confirmation_required');
  assert.equal(resolveTaobaoChannel({ requested: 'web', probes: { web: { status: 'ready', operations: { productDetail: true } } } }).status, 'blocked');
  assert.equal(resolveTaobaoChannel().reason, 'unverified');
});

test('authentication, verification and rate limits never trigger automatic fallback', () => {
  for (const status of ['login_required', 'captcha_required', 'rate_limited', 'access_restricted', 'unverified']) {
    const result = resolveTaobaoChannel({ probes: { native: { status }, web: ready } });
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, status);
    assert.equal(result.suggestedChannel, undefined);
  }
});

test('active runs pin their channel and explicit switches invalidate evidence', () => {
  assert.equal(resolveTaobaoChannel({ activeChannel: 'native', probes: { native: { status: 'unavailable' }, web: ready } }).status, 'blocked');
  const switchRequest = resolveTaobaoChannel({ activeChannel: 'native', requested: 'web', probes: { web: ready } });
  assert.equal(switchRequest.status, 'switch_confirmation_required');
  assert.equal(switchRequest.invalidateEvidence, true);
});
