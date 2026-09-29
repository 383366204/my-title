import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const { confirmCopyRecordsStable } = require('../../skills/1688-distribution');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.setContent('<input placeholder="逗号或空格"><button id="search">搜索</button><table><tbody></tbody></table><button id="next">下一页</button>');
  await page.evaluate(() => {
    window.setTimeout = callback => { callback(); return 1; };
    window.queries = [];
    window.pages = [
      '<tr><td>甲店</td><td>上家ID：123456</td><td>复制成功</td><td>2026-09-27 10:00:00</td></tr>',
      '<tr><td>甲店</td><td>上家ID：123456</td><td>复制失败 不支持类目</td><td>2026-09-28 10:00:00</td></tr><tr><td>甲店</td><td>上家ID：234567</td><td>复制中</td><td>2026-09-28 10:00:00</td></tr>'
    ];
    window.render = () => {
      document.querySelector('tbody').innerHTML = window.pages[window.index];
      document.querySelector('#next').disabled = window.index === window.pages.length - 1;
    };
    document.querySelector('#search').onclick = () => { window.queries.push(document.querySelector('input').value); window.index = 0; window.render(); };
    document.querySelector('#next').onclick = () => { window.index++; window.render(); };
  });
  const client = { evaluate: expression => expression === 'window.__ecom1688.readState()'
    ? Promise.resolve({ url: 'https://item.jnesoft.com/ali_view/ali_batchLog', body: '复制日志' }) : page.evaluate(expression) };
  const options = { submittedAt: '2026-09-28T01:00:00Z' };
  let result = await confirmCopyRecordsStable(client, ['123456', '234567', '345678'], { platformShopName: '甲店' }, 'random', options);
  assert.deepEqual(result.issueOfferIds, ['123456']);
  assert.deepEqual(result.foundOfferIds, []);
  assert.equal(result.byShop[0].perOfferId['234567'].status, 'copying');
  assert.equal(result.byShop[0].perOfferId['345678'].status, 'unknown');
  assert.match(result.byShop[0].perOfferId['123456'].reason, /不支持类目/);
  assert.deepEqual(await page.evaluate(() => window.queries), ['']);
  await page.evaluate(() => { window.pages[1] = window.pages[1].replace('复制失败 不支持类目', '复制成功').replace('复制中', '复制成功'); });
  result = await confirmCopyRecordsStable(client, ['123456', '234567'], { platformShopName: '甲店' }, 'random', options);
  assert.equal(result.status, 'confirmed');
  result = await confirmCopyRecordsStable(client, ['123456'], [{ platformShopName: '甲店' }, { platformShopName: '乙店' }], 'repeat', options);
  assert.notEqual(result.status, 'confirmed', 'repeat distribution requires every target shop');
  result = await confirmCopyRecordsStable(client, ['123456'], [{ platformShopName: '甲店' }, { platformShopName: '乙店' }], 'random', options);
  assert.equal(result.status, 'confirmed');
  result = await confirmCopyRecordsStable(client, ['123456'], { platformShopName: '甲店' }, 'random', { ...options, maxPages: 1 });
  assert.equal(result.scanIncomplete, true);
  assert.notEqual(result.status, 'confirmed');
  await page.evaluate(() => { window.pages = ['<tr><td>甲店</td><td>上家ID：123456</td><td>复制成功</td></tr>']; });
  result = await confirmCopyRecordsStable(client, ['123456'], { platformShopName: '甲店' }, 'random', options);
  assert.equal(result.status, 'not_confirmed', 'undated records must not confirm a new submission');
  console.log('Paginated distribution confirmation passed');
} finally { await browser.close(); }
