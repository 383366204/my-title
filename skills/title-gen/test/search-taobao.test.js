const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, beforeEach, afterEach } = require('node:test');

const guard = require('../../../core/platform-access-guard');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'taobao-guard-'));
}

beforeEach(() => {
  guard.resetPlatformAccessState();
  delete require.cache[require.resolve('../src/search-taobao')];
});

afterEach(() => {
  delete process.env.ECOM_PLATFORM_GUARD_DIR;
});

test('searchTaobaoTitles caches by keyword and avoids duplicate native calls', async () => {
  const dataDir = tempDataDir();
  process.env.ECOM_PLATFORM_GUARD_DIR = dataDir;

  const taobaoUtilsPath = require.resolve('../src/taobao-utils');
  const original = require.cache[taobaoUtilsPath];
  let calls = 0;
  require.cache[taobaoUtilsPath] = {
    id: taobaoUtilsPath,
    filename: taobaoUtilsPath,
    loaded: true,
    exports: {
      isTaobaoNativeInstalled: () => true,
      ensureTaobaoDesktopReady: async () => true,
      runTaobaoNativeSync: () => {
        calls += 1;
        return JSON.stringify({ result: { products: [{ title: '纯银项链女高级感' }] } });
      }
    }
  };

  try {
    const { searchTaobaoTitles } = require('../src/search-taobao');
    const first = await searchTaobaoTitles('纯银项链', { maxResults: 10, guardMinCooldownMs: 0, guardMaxCooldownMs: 0 });
    const second = await searchTaobaoTitles('纯银项链', { maxResults: 10, guardMinCooldownMs: 0, guardMaxCooldownMs: 0 });

    assert.deepEqual(first, ['纯银项链女高级感']);
    assert.deepEqual(second, ['纯银项链女高级感']);
    assert.equal(calls, 1);
  } finally {
    if (original) require.cache[taobaoUtilsPath] = original;
    else delete require.cache[taobaoUtilsPath];
  }
});

test('guardTaobaoImageSearch caches image search result by image url', async () => {
  const dataDir = tempDataDir();
  let calls = 0;
  const { guardTaobaoImageSearch } = require('../src/search-taobao-image');

  const first = await guardTaobaoImageSearch('https://img.example/a.jpg', {
    guardDataDir: dataDir,
    guardMinCooldownMs: 0,
    guardMaxCooldownMs: 0,
    operation: async () => {
      calls += 1;
      return { hasMatch: true, peerTitles: ['同款项链'], priceRange: { min: 10, max: 20 } };
    }
  });

  const second = await guardTaobaoImageSearch('https://img.example/a.jpg', {
    guardDataDir: dataDir,
    guardMinCooldownMs: 0,
    guardMaxCooldownMs: 0,
    operation: async () => {
      calls += 1;
      return { hasMatch: false, peerTitles: [] };
    }
  });

  assert.equal(calls, 1);
  assert.equal(first.peerTitles[0], '同款项链');
  assert.equal(second.peerTitles[0], '同款项链');
});
