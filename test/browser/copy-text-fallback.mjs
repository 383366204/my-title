/**
 * Phase 0.2 P1: Real copyText fallback chain test.
 *
 * Imports the ACTUAL copyText from production code and tests its
 * execCommand → clipboard.writeText → reject fallback chain.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');

// Import the REAL copyText from production source
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { copyText } from '/src/features/workflow/copy-text.js';
window.copyText = copyText;
createRoot(document.getElementById('root')).render(React.createElement('div', null, 'ready'));
`;

const server = await createServer({
  root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, proxy: {} },
  plugins: [{
    name: 'copy-fixture',
    resolveId(id) { if (id === '/__copy-test.js') return id; },
    load(id) { if (id === '/__copy-test.js') return harness; },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== '/__copy-test') return next();
        res.setHeader('Content-Type', 'text/html');
        vite.transformIndexHtml('/__copy-test', '<html><body><div id="root"></div><script type="module" src="/__copy-test.js"></script></body></html>')
          .then(html => res.end(html)).catch(next);
      });
    }
  }]
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__copy-test`);
  await page.locator('div').first().waitFor();

  // Test 1: Normal copy in headless Chrome (execCommand or clipboard should work)
  const result1 = await page.evaluate(async () => {
    try {
      await window.copyText('test content');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  assert.ok(result1.ok, `copyText should succeed in headless Chrome: ${result1.error || ''}`);

  // Test 2: Textarea cleanup — no leftover textareas after copy
  const textareaCount = await page.evaluate(() => document.querySelectorAll('textarea').length);
  assert.equal(textareaCount, 0, 'textarea should be cleaned up after copy');

  // Test 3: execCommand returns false → falls through to clipboard
  const result3 = await page.evaluate(async () => {
    const origExec = document.execCommand;
    document.execCommand = () => false; // force fallback
    try {
      await window.copyText('fallback test');
      return { ok: true, path: 'clipboard' };
    } catch (e) {
      return { ok: false, error: e.message, path: 'failed' };
    } finally {
      document.execCommand = origExec;
    }
  });
  assert.ok(result3.ok, `should fall through to clipboard when execCommand returns false: ${result3.error || ''}`);

  // Test 4: Both APIs fail → rejects with Chinese message
  const result4 = await page.evaluate(async () => {
    const origExec = document.execCommand;
    const origClipboard = navigator.clipboard;
    document.execCommand = () => false;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      await window.copyText('no-api test');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      document.execCommand = origExec;
      Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
    }
  });
  assert.ok(!result4.ok, 'should reject when no API available');
  assert.ok(result4.error.includes('不支持复制'), `error should be Chinese message, got: ${result4.error}`);

  // Test 5: Textarea cleanup even when execCommand succeeds
  const result5 = await page.evaluate(async () => {
    await window.copyText('cleanup test');
    return document.querySelectorAll('textarea').length;
  });
  assert.equal(result5, 0, 'textarea must be cleaned up in finally block');

  // Test 6: Empty/null input handled gracefully
  const result6 = await page.evaluate(async () => {
    try {
      await window.copyText(null);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  assert.ok(result6.ok, 'null input should not throw');

  console.log('Copy text fallback chain test passed');
} finally {
  await browser?.close();
  await server.close();
}
