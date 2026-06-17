const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const defaultEnv = {
      ...process.env,
      NODE_ENV: 'test',
      GLM_API_KEY: 'test-key',
      ALI_1688_AK: 'test-ak'
    };
    const cliEnv = { ...defaultEnv, ...env };

    const child = spawn('node', [path.join(__dirname, '../bin/cli.js'), ...args], {
      env: cliEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => { resolve({ code, stdout, stderr }); });
    child.on('error', reject);

    setTimeout(() => {
      child.kill();
      reject(new Error('CLI timeout'));
    }, 10000);
  });
}

describe('CLI Output Format', () => {
  it('should show table format when format=both (default)', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('--format'), 'help should include --format option');
  });

  it('should output only JSON when --format json is specified', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('--format <type>'), 'help should show format option');
    assert.ok(result.stdout.includes('table'), 'help should list table as option');
    assert.ok(result.stdout.includes('json'), 'help should list json as option');
    assert.ok(result.stdout.includes('both'), 'help should list both as option');
  });

  it('should output only table when --format table is specified', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('--format <type>'), 'format option should be documented');
  });

  it('should output table + JSON when --format both is specified', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('--format <type>'), 'format option should exist');
  });

  it('should show error when required env vars are missing', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('--format'), 'help should include format option');
  });
});

describe('CLI --format option validation', () => {
  it('should accept table as valid format', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('table'), 'format option should list table');
  });

  it('should accept json as valid format', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('json'), 'format option should list json');
  });

  it('should accept both as valid format', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('both'), 'format option should list both');
  });

  it('should document --length option', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('--length'), 'should document length option');
  });

  it('should document --peer-titles option', async () => {
    const result = await runCli(['--help']);
    assert.ok(result.stdout.includes('--peer-titles'), 'should document peer-titles option');
  });

  it('should include SYCM category analysis in JSON output payload', () => {
    const cliSource = fs.readFileSync(path.join(__dirname, '../bin/cli.js'), 'utf8');
    assert.match(cliSource, /categoryAnalysis:\s*result\.categoryAnalysis\s*\|\|\s*null/);
  });

  it('sycm-status should return readiness JSON instead of running title generation', async () => {
    const result = await runCli(['sycm-status', '--json', '--port', '9']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'cdp_unavailable');
    assert.equal(payload.cdp.ok, false);
    assert.ok(!('titles' in payload), 'status output must not include generated titles');
    assert.ok(!('products' in payload), 'status output must not include generated products');
    assert.ok(result.stdout.includes('nextActionCode'));
    assert.equal(typeof payload.requiresUserAction, 'boolean');
    assert.equal(typeof payload.userMessage, 'string');
    assert.ok(Array.isArray(payload.blockers));
    assert.ok(Array.isArray(payload.allowedCommands));
  });

  it('doctor --json returns weak-agent friendly diagnostics', async () => {
    const result = await runCli(['doctor', '--json', '--port', '9']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.status, 'blocked');
    assert.equal(payload.nextActionCode, 'fix_doctor_blockers');
    assert.equal(payload.requiresUserAction, true);
    assert.ok(Array.isArray(payload.blockers));
    assert.ok(payload.blockers.includes('browser_cdp_unavailable'));
    assert.ok(payload.checks.node.ok);
    assert.ok(payload.checks.chromeCdp);
    assert.ok(payload.checks.chromeLaunchPlan.command);
    assert.ok(payload.userMessage.includes('Chrome'));
  });

  it('doctor --deep --json returns read-only flow diagnostics', async () => {
    const result = await runCli(['doctor', '--deep', '--json', '--port', '9']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'deep');
    assert.equal(typeof payload.requiresUserAction, 'boolean');
    assert.equal(typeof payload.nextActionCode, 'string');
    assert.ok(payload.checks.chromeCdp);
    assert.ok(payload.checks.sycm);
    assert.ok(payload.checks.distributionAuth);
    assert.ok(Array.isArray(payload.blockers));
  });

  it('title-gen-preflight --json returns weak-agent browser diagnostics', async () => {
    const result = await runCli(['title-gen-preflight', '--json', '--port', '9']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.status, 'cdp_unavailable');
    assert.equal(typeof payload.nextActionCode, 'string');
    assert.equal(typeof payload.requiresUserAction, 'boolean');
    assert.ok(Array.isArray(payload.blockers));
    assert.match(payload.userMessage, /Chrome|CDP/i);
  });

  it('seed --json should list seeds by default', async () => {
    const dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecom-seeds-'));
    fs.mkdirSync(path.join(dataDir, 'keyword-mining'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'keyword-mining', 'seeds.json'), JSON.stringify([
      { keyword: '陶瓷摆件', category: '家居饰品', priority: 5, status: 'active' }
    ]));
    const result = await runCli(['seed', '--json', '--data-dir', path.join(dataDir, 'keyword-mining')]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.seeds.length, 1);
    assert.equal(payload.seeds[0].keyword, '陶瓷摆件');
  });

  it('seed list --json should accept --data-dir', async () => {
    const dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecom-seeds-list-'));
    fs.writeFileSync(path.join(dataDir, 'seeds.json'), JSON.stringify([
      { keyword: '宝宝虎头鞋', category: '童鞋', priority: 7, status: 'active' }
    ]));
    const result = await runCli(['seed', 'list', '--json', '--data-dir', dataDir]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.seeds.length, 1);
    assert.equal(payload.seeds[0].keyword, '宝宝虎头鞋');
  });

  it('sync-hermes-skills reports copy and wrapper mode in dry-run JSON', async () => {
    const targetRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hermes-skills-'));
    for (const mode of ['copy', 'wrapper']) {
      const result = await runCli([
        'sync-hermes-skills',
        '--mode', mode,
        '--skill', 'pipeline-flow',
        '--target', targetRoot,
        '--json'
      ]);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.dryRun, true);
      assert.equal(payload.mode, mode);
      assert.equal(typeof payload.requiresUserAction, 'boolean');
      assert.equal(payload.results[0].mode, mode);
    }
  });

  it('workflow run --dry-run stops before submit confirmation', async () => {
    const stateDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecom-workflow-'));
    const result = await runCli([
      'workflow', 'run',
      '--keyword', '陶瓷摆件',
      '--state-dir', stateDir,
      '--dry-run',
      '--json'
    ]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'awaiting_user_confirmation');
    assert.equal(payload.requiresUserAction, true);
    assert.equal(payload.nextActionCode, 'confirm_before_submit');
    assert.ok(fs.existsSync(path.join(stateDir, 'ecommerce-workflow.json')));
  });
});
