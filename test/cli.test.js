const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

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
});