const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeWorkflowParams } = require('../../../../core/workflow/pipeline-params');
const { enrichCompetitorProduct } = require('../../../../skills/competitor-analysis/src/collector');
const { resolveWebCompetitorShop } = require('../../../../skills/competitor-analysis/src/web-collector');

test('competitor channel and debug port survive parameter sanitization', () => {
  const params = sanitizeWorkflowParams('competitor-analysis', { competitorText: 'https://m.tb.cn/h.test', taobaoChannel: 'web', port: 9223 });
  assert.equal(params.taobaoChannel, 'web');
  assert.equal(params.port, 9223);
  assert.equal(sanitizeWorkflowParams('competitor-analysis', { competitorText: 'https://m.tb.cn/h.test' }).taobaoChannel, 'native');
  assert.throws(() => sanitizeWorkflowParams('competitor-analysis', { competitorText: 'x', taobaoChannel: 'other' }));
});

test('web enrichment preserves captured product links without calling native client', async () => {
  const result = await enrichCompetitorProduct({}, { itemId: '123', productUrl: 'https://item.taobao.com/item.htm?id=123' }, {
    taobaoChannel: 'web', client: new Proxy({}, { get() { throw new Error('native client used'); } })
  });
  assert.equal(result.itemId, '123');
  assert.ok(result.enrichedAt);
  await assert.rejects(enrichCompetitorProduct({}, {}, { taobaoChannel: 'web' }), /缺少有效链接/);
});

test('web resolver rejects foreign URLs before opening Chrome', async () => {
  await assert.rejects(resolveWebCompetitorShop({ inputUrl: 'https://example.com/' }), /无效/);
});
