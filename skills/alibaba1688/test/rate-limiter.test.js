const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

function runAcquireChild(dataDir, goFile) {
  const script = `
    const fs = require('fs');
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    fs.writeFileSync = function(...args) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
      return originalWriteFileSync(...args);
    };
    const { GlobalRateLimiter } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'rate-limiter.js'))});
    while (!fs.existsSync(${JSON.stringify(goFile)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    (async () => {
      const limiter = new GlobalRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        cooldownMs: 60000,
        maxQueueSize: 0,
        persist: true,
        dataDir: ${JSON.stringify(dataDir)},
        lockTimeoutMs: 2000,
        staleLockMs: 2000
      });
      const result = await limiter.acquire();
      process.stdout.write(JSON.stringify(result));
    })().catch(err => {
      process.stderr.write(err.stack || err.message || String(err));
      process.exit(1);
    });
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) {
        reject(new Error(stderr || `child exited with ${code}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test('1688 persisted rate window acquisition is atomic across processes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '1688-atomic-window-'));
  const goFile = path.join(dataDir, 'go');

  const first = runAcquireChild(dataDir, goFile);
  const second = runAcquireChild(dataDir, goFile);
  fs.writeFileSync(goFile, 'go', 'utf8');

  const results = await Promise.all([first, second]);
  const allowedCount = results.filter(result => result.allowed).length;
  const rejectedCount = results.filter(result => !result.allowed && result.queueFull).length;

  assert.equal(allowedCount, 1);
  assert.equal(rejectedCount, 1);
});
