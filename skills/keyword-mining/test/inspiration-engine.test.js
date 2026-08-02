const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  assessInspiration,
  assessRootCandidate,
  collectInspirations,
  discoverInspirationRoots,
  mineKeywords,
  parseFeedItems,
  productizeInspirations
} = require('..');
const { buildHistoryKeys } = require('../../../core/history-record');

describe('inspiration discovery', () => {
  test('parses RSS and Atom feeds with a structured XML parser', () => {
    const rss = parseFeedItems(`<?xml version="1.0"?><rss><channel><title>测试新闻</title><item><title>多地迎来高温天气</title><link>https://example.com/a</link><pubDate>2026-08-01</pubDate></item></channel></rss>`);
    const atom = parseFeedItems(`<?xml version="1.0"?><feed><title>测试订阅</title><entry><title>高校陆续开学</title><link href="https://example.com/b"/><updated>2026-08-02</updated></entry></feed>`);
    assert.equal(rss[0].title, '多地迎来高温天气');
    assert.equal(rss[0].url, 'https://example.com/a');
    assert.equal(atom[0].title, '高校陆续开学');
    assert.equal(atom[0].url, 'https://example.com/b');
  });

  test('daily dictionary sampling is deterministic per date and changes by run attempt', async () => {
    const options = {
      date: '2026-08-02',
      newsItems: [],
      newsFeedUrls: [],
      dictionaryWords: ['清凉', '安静', '旅行', '收纳', '运动', '照明'],
      sourceLimits: { news: 0, dictionary: 3, calendar: 0, trend: 0 }
    };
    const first = await collectInspirations({ ...options, runAttempt: 0 });
    const replay = await collectInspirations({ ...options, runAttempt: 0 });
    const rerun = await collectInspirations({ ...options, runAttempt: 1 });
    assert.deepEqual(first.inspirations.map(item => item.inspirationWord), replay.inspirations.map(item => item.inspirationWord));
    assert.notDeepEqual(first.inspirations.map(item => item.inspirationWord), rerun.inspirations.map(item => item.inspirationWord));
  });

  test('blocks sensitive news and non-product or brand roots', () => {
    assert.equal(assessInspiration({ rawSourceText: '事故造成多人伤亡', inspirationWord: '伤亡' }).ok, false);
    assert.equal(assessRootCandidate({ rootKeyword: '宿舍好物' }).rejectReason, 'abstract_root');
    assert.equal(assessRootCandidate({ rootKeyword: '迪士尼书包' }).rejectReason, 'brand_or_ip_risk');
    assert.equal(assessRootCandidate({ rootKeyword: '小风扇' }).groundingStatus, 'passed');
  });

  test('uses local product associations when no LLM is configured', async () => {
    const inspirations = [{
      id: 'insp_hot',
      sourceType: 'news',
      inspirationWord: '高温',
      rawSourceText: '多地进入高温天气',
      contextWords: ['高温', '天气']
    }];
    const result = await productizeInspirations(inspirations, { useLLM: false });
    assert.deepEqual(result.roots.map(item => item.rootKeyword), ['小风扇', '冰垫', '凉席']);
    assert.equal(result.meta.provider, 'local-fallback');
  });

  test('discovers diverse product roots without reading a seed pool', async () => {
    const result = await discoverInspirationRoots({
      date: '2026-08-02',
      runAttempt: 0,
      rootLimit: 4,
      useLLM: false,
      newsItems: [
        { title: '多地进入高温天气', inspirationWord: '高温' },
        { title: '高校宿舍迎来开学季', inspirationWord: '开学' }
      ],
      dictionaryWords: ['旅行', '运动', '照明', '收纳'],
      trendItems: [{ keyword: '宠物陪伴', title: '宠物陪伴用品增长' }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.selectedRoots.length, 4);
    assert.equal(new Set(result.selectedRoots.map(item => item.familyKey)).size, 4);
    assert.ok(result.selectedRoots.every(item => item.coreProduct));
    assert.ok(result.selectedRoots.every(item => item.inspiration?.sourceType));
  });

  test('filters roots and families that are still cooling down', async () => {
    const keys = buildHistoryKeys({ keyword: '小风扇', coreProduct: '小风扇', familyKey: '小风扇' });
    const history = { keywords: {}, signatures: {}, families: {} };
    history.keywords[keys.keywordKey] = { lastSeenAt: '2026-08-01T12:00:00.000Z', runCount: 1 };
    history.families[keys.familyKey] = { lastSeenAt: '2026-08-01T12:00:00.000Z', runCount: 1 };
    const result = await discoverInspirationRoots({
      date: '2026-08-02',
      rootLimit: 3,
      useLLM: false,
      newsItems: [{ title: '高温天气持续', inspirationWord: '高温' }],
      dictionaryWords: [],
      trendItems: [],
      history
    });
    assert.equal(result.selectedRoots.some(item => item.rootKeyword === '小风扇'), false);
    assert.ok(result.roots.some(item => item.rootKeyword === '小风扇' && item.rejectReason === 'root_cooldown'));
  });

  test('mines SYCM long-tail candidates in inspiration mode without seeds', async () => {
    const calls = [];
    const result = await mineKeywords({
      source: 'inspiration',
      date: '2026-08-02',
      rootLimit: 2,
      count: 4,
      persist: false,
      inspirationUseLLM: false,
      newsItems: [{ title: '多地进入高温天气', inspirationWord: '高温' }],
      dictionaryWords: [],
      trendItems: [],
      sycmExtractor: async (keyword, options) => {
        calls.push({ keyword, options });
        return {
          data: [
            { keyword },
            { keyword: `${keyword}夏季`, searchPopularity: 1800, demandSupplyRatio: 1.8, conversionRate: 0.08 }
          ]
        };
      }
    });
    assert.equal(result.seedsUsed, 0);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.options.maxPages === 1));
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every(item => item.source === 'inspiration'));
    assert.ok(result.candidates.every(item => item.inspirationId));
  });
});
