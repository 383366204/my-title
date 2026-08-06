'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  requestRuntimePause,
  requestRuntimeResume,
  requestRuntimeRetryStep,
  clearRuntimeControl,
  readRuntimeControl,
  appendRuntimeEvent,
  readRuntimeEvents,
  assertRuntimeRunId
} = require('../runtime/store');
const { runPipelineRuntime } = require('../runtime/runner');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-runtime-'));
}

describe('pipeline runtime store', () => {
  it('initializes and updates runtime state under the run directory', () => {
    const dataDir = tempDataDir();
    const runtime = initRuntimeState({
      dataDir,
      runId: 'run_1',
      steps: ['mine', 'verify'],
      mode: 'daily',
      params: { mine: 9, verify: 3 }
    });

    assert.equal(runtime.status, 'running');
    assert.equal(runtime.activeStep, 'mine');
    assert.equal(runtime.mode, 'daily');
    assert.deepEqual(runtime.params, { mine: 9, verify: 3 });
    assert.equal(runtime.progress.mine.status, 'idle');

    updateRuntimeState({
      dataDir,
      runId: 'run_1',
      patch: {
        activeStep: 'verify',
        progress: {
          verify: { status: 'running', current: 1, total: 3, percent: 33, message: '验真 1/3' }
        }
      }
    });

    const updated = readRuntimeState({ dataDir, runId: 'run_1' });
    assert.equal(updated.activeStep, 'verify');
    assert.equal(updated.progress.verify.percent, 33);
    assert.equal(updated.progress.mine.status, 'idle');
  });

  it('persists cancel requests separately from runtime state', () => {
    const dataDir = tempDataDir();
    initRuntimeState({ dataDir, runId: 'run_2', steps: ['mine'] });

    requestRuntimeCancel({ dataDir, runId: 'run_2', reason: 'user_cancelled' });

    const control = readRuntimeControl({ dataDir, runId: 'run_2' });
    assert.equal(control.requestedAction, 'cancel');
    assert.equal(control.reason, 'user_cancelled');
  });

  it('persists pause resume and retry-step control requests', () => {
    const dataDir = tempDataDir();
    initRuntimeState({ dataDir, runId: 'run_control', steps: ['mine', 'verify', 'generate'] });

    const pause = requestRuntimePause({ dataDir, runId: 'run_control', reason: 'user_pause' });
    assert.equal(pause.requestedAction, 'pause');
    assert.equal(pause.reason, 'user_pause');
    assert.ok(pause.updatedAt);

    const resume = requestRuntimeResume({ dataDir, runId: 'run_control' });
    assert.equal(resume.requestedAction, 'resume');

    const retry = requestRuntimeRetryStep({ dataDir, runId: 'run_control', step: 'verify', reason: 'manual_retry' });
    assert.equal(retry.requestedAction, 'retry-step');
    assert.equal(retry.step, 'verify');
    assert.equal(retry.reason, 'manual_retry');

    const cleared = clearRuntimeControl({ dataDir, runId: 'run_control' });
    assert.equal(cleared.requestedAction, null);
    assert.equal(readRuntimeControl({ dataDir, runId: 'run_control' }).requestedAction, null);
  });

  it('appends and reads ordered runtime events', () => {
    const dataDir = tempDataDir();
    initRuntimeState({ dataDir, runId: 'run_3', steps: ['mine'] });

    const first = appendRuntimeEvent({
      dataDir,
      runId: 'run_3',
      event: { event: 'progress', step: 'mine', percent: 10 }
    });
    const second = appendRuntimeEvent({
      dataDir,
      runId: 'run_3',
      event: { event: 'progress', step: 'mine', percent: 100 }
    });

    assert.equal(first.runId, 'run_3');
    assert.equal(second.runId, 'run_3');
    assert.ok(first.timestamp);
    assert.ok(second.timestamp);
    assert.deepEqual(readRuntimeEvents({ dataDir, runId: 'run_3' }).map(event => event.percent), [10, 100]);
  });

  it('skips malformed runtime event lines', () => {
    const dataDir = tempDataDir();
    initRuntimeState({ dataDir, runId: 'run_4', steps: ['mine'] });
    fs.appendFileSync(
      path.join(dataDir, 'runs', 'run_4', 'workflow-events.jsonl'),
      '{bad json}\n{"event":"progress","step":"mine","percent":50}\n',
      'utf8'
    );

    const events = readRuntimeEvents({ dataDir, runId: 'run_4' });

    assert.deepEqual(events, [{ event: 'progress', step: 'mine', percent: 50 }]);
  });

  it('rejects unsafe run ids', () => {
    const dataDir = tempDataDir();
    assert.throws(() => assertRuntimeRunId('../bad'), /Invalid runtime run id/);
    assert.throws(() => initRuntimeState({ dataDir, runId: '../bad', steps: ['mine'] }), /Invalid runtime run id/);
    assert.throws(() => requestRuntimeCancel({ dataDir, runId: '../bad' }), /Invalid runtime run id/);
  });
});
describe('pipeline runtime runner', () => {
  it('runs manual direct-input mode from start to product enrichment without keyword review', async () => {
    const dataDir = tempDataDir();
    const runId = 'manual_runtime_v2';
    const result = await runPipelineRuntime({
      dataDir,
      runId,
      mode: 'manual',
      steps: ['start', 'select'],
      params: {
        items: [{ keyword: '法式连衣裙', url: 'https://detail.1688.com/offer/123456.html' }],
        detailFetcher: async () => ({
          model: { bizData: { title: '法式碎花收腰连衣裙夏季女装', categoryName: '女装 > 连衣裙' } }
        })
      }
    });

    const runtime = readRuntimeState({ dataDir, runId });
    assert.equal(result.status, 'products_selected');
    assert.deepEqual(runtime.steps, ['start', 'select']);
    assert.equal(runtime.progress.start.status, 'completed');
    assert.equal(runtime.progress.select.status, 'completed');
    assert.equal(runtime.progress.keywordReview, undefined);
  });

  it('runs steps in order and writes progress events', async () => {
    const dataDir = tempDataDir();
    const calls = [];
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: { mine: 2, verify: 1, generate: 1, export: 1 },
      steps: ['mine', 'verify'],
      stepFns: {
        mine: async ({ reportProgress }) => {
          calls.push('mine');
          reportProgress({ current: 1, total: 2, message: '挖词 1/2' });
          return {
            runId: 'runtime_run',
            runDir: path.join(dataDir, 'runs', 'runtime_run'),
            candidates: [{ keyword: 'a' }, { keyword: 'b' }]
          };
        },
        verify: async ({ runId, reportProgress }) => {
          calls.push(`verify:${runId}`);
          reportProgress({ current: 1, total: 1, message: '验真完成' });
          return { status: 'verified', verified: [{ keyword: 'a' }], rejected: [] };
        }
      }
    });

    assert.deepEqual(calls, ['mine', 'verify:runtime_run']);
    assert.equal(result.runId, 'runtime_run');
    const runtime = readRuntimeState({ dataDir, runId: 'runtime_run' });
    assert.equal(runtime.status, 'completed');
    assert.equal(runtime.progress.verify.percent, 100);
    assert.ok(readRuntimeEvents({ dataDir, runId: 'runtime_run' }).some(event => event.event === 'progress'));
  });

  it('default mine step writes visible mining stage progress events', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: { mine: 5, discoveryMode: 'seed', source: 'local' },
      steps: ['mine']
    });

    const events = readRuntimeEvents({ dataDir, runId: result.runId })
      .filter(event => event.event === 'progress' && event.step === 'mine');
    assert.ok(events.some(event => event.message === '读取种子池'));
    assert.ok(events.some(event => event.message.includes('扩展候选词')));
    assert.ok(events.some(event => event.message.includes('排序筛选')));
  });

  it('runs exact keyword mode with canvas-aligned production steps', async () => {
    const dataDir = tempDataDir();
    const calls = [];
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'keyword',
      params: { keyword: '纯银项链', export: 3 },
      stepFns: {
        start: async ({ reportProgress, params }) => {
          calls.push(`start:${params.keyword}`);
          reportProgress({ current: 1, total: 1, message: '准备精确关键词' });
          return { status: 'mined' };
        },
        verify: async ({ reportProgress }) => {
          calls.push('verify');
          reportProgress({ current: 1, total: 1, message: '验真完成' });
          return { status: 'verified' };
        },
        select: async ({ reportProgress }) => {
          calls.push('select');
          reportProgress({ current: 1, total: 1, message: '选品完成' });
          return { status: 'products_selected' };
        },
        generate: async ({ reportProgress }) => {
          calls.push('generate');
          reportProgress({ current: 1, total: 1, message: '生成完成' });
          return { status: 'generated' };
        },
        export: async ({ reportProgress, params }) => {
          calls.push(`export:${params.export}`);
          reportProgress({ current: 1, total: 1, message: '导出完成' });
          return { status: 'workflow_complete' };
        },
        review: async () => {
          calls.push('review');
          return { status: 'needs_review' };
        }
      }
    });

    assert.deepEqual(calls, ['start:纯银项链', 'verify', 'select', 'generate', 'export:3']);
    assert.equal(result.runtimeStatus, 'completed');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.mode, 'keyword');
    assert.deepEqual(runtime.steps, ['start', 'verify', 'select', 'generate', 'export']);
    assert.equal(runtime.progress.start.status, 'completed');
    assert.equal(runtime.progress.verify.status, 'completed');
    assert.equal(runtime.progress.select.status, 'completed');
    assert.equal(runtime.progress.generate.status, 'completed');
    assert.equal(runtime.progress.export.status, 'completed');
  });

  it('prepares every exact keyword before verification', async () => {
    const dataDir = tempDataDir();
    const keywords = ['纯银项链', '桌面收纳盒', '纯银项链'];
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'keyword',
      params: { keywords },
      steps: ['start']
    });

    const candidates = fs.readFileSync(path.join(result.runDir, 'candidates.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map(line => JSON.parse(line));
    assert.deepEqual(candidates.map(row => row.keyword), ['纯银项链', '桌面收纳盒']);
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.deepEqual(runtime.params.keywords, keywords);
    assert.equal(runtime.progress.start.total, 2);
  });

  it('keeps progress percent safe for unusual totals', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['mine'],
      stepFns: {
        mine: async ({ reportProgress }) => {
          reportProgress({ current: 5, total: 0, message: 'unknown total' });
          reportProgress({ current: -1, total: 3, message: 'negative current' });
          reportProgress({ current: 10, total: 3, message: 'over total' });
          return { status: 'mined' };
        }
      }
    });

    const events = readRuntimeEvents({ dataDir, runId: result.runId })
      .filter(event => event.event === 'progress')
      .map(event => event.percent);

    assert.deepEqual(events, [100, 0, 100]);
  });

  it('cancels between safe step boundaries', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['mine', 'verify'],
      stepFns: {
        mine: async ({ reportProgress, runId }) => {
          reportProgress({ current: 1, total: 1, message: 'mine done' });
          requestRuntimeCancel({ dataDir, runId, reason: 'test_cancel' });
          return { runId, runDir: path.join(dataDir, 'runs', runId), candidates: [] };
        },
        verify: async () => {
          throw new Error('verify should not run after cancel');
        }
      }
    });

    assert.equal(result.status, 'cancelled');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.status, 'cancelled');
    assert.equal(runtime.activeStep, 'verify');
  });

  it('pauses between safe step boundaries and records the next active step', async () => {
    const dataDir = tempDataDir();
    const calls = [];
    const result = await runPipelineRuntime({
      dataDir,
      runId: 'pause_boundary_run',
      mode: 'daily',
      params: {},
      steps: ['mine', 'verify', 'generate'],
      stepFns: {
        mine: async ({ reportProgress, runId }) => {
          calls.push('mine');
          reportProgress({ current: 1, total: 1, message: 'mine done' });
          requestRuntimePause({ dataDir, runId, reason: 'user_pause' });
          return { runId, runDir: path.join(dataDir, 'runs', runId), status: 'mined' };
        },
        verify: async () => {
          calls.push('verify');
          throw new Error('verify should not run after pause');
        },
        generate: async () => {
          calls.push('generate');
          throw new Error('generate should not run after pause');
        }
      }
    });

    assert.deepEqual(calls, ['mine']);
    assert.equal(result.status, 'paused');
    assert.equal(result.runtimeStatus, 'paused');
    const runtime = readRuntimeState({ dataDir, runId: 'pause_boundary_run' });
    assert.equal(runtime.status, 'paused');
    assert.equal(runtime.activeStep, 'verify');
    assert.equal(runtime.progress.mine.status, 'completed');
    assert.equal(runtime.progress.verify.status, 'idle');
    assert.ok(readRuntimeEvents({ dataDir, runId: 'pause_boundary_run' }).some(event => {
      return event.event === 'status' && event.status === 'paused';
    }));
  });

  it('resumes a paused run from the stored active step without rerunning completed steps', async () => {
    const dataDir = tempDataDir();
    const firstCalls = [];
    await runPipelineRuntime({
      dataDir,
      runId: 'resume_run',
      mode: 'daily',
      params: { mine: 1, verify: 7, generate: 3, marker: 'keep-me' },
      steps: ['mine', 'verify', 'generate'],
      stepFns: {
        mine: async ({ reportProgress, runId }) => {
          firstCalls.push('mine');
          reportProgress({ current: 1, total: 1, message: 'mine done' });
          requestRuntimePause({ dataDir, runId, reason: 'pause_before_verify' });
          return { runId, runDir: path.join(dataDir, 'runs', runId), status: 'mined' };
        },
        verify: async () => {
          firstCalls.push('verify');
          throw new Error('verify should not run before resume');
        },
        generate: async () => {
          firstCalls.push('generate');
          throw new Error('generate should not run before resume');
        }
      }
    });

    const secondCalls = [];
    const result = await runPipelineRuntime({
      dataDir,
      runId: 'resume_run',
      mode: 'daily',
      preserveRuntime: true,
      resumeFromStep: 'verify',
      steps: ['mine', 'verify', 'generate'],
      stepFns: {
        mine: async () => {
          secondCalls.push('mine');
          throw new Error('mine should not rerun on resume');
        },
        verify: async ({ reportProgress, params }) => {
          secondCalls.push('verify');
          assert.equal(params.verify, 7);
          assert.equal(params.marker, 'keep-me');
          reportProgress({ current: 1, total: 1, message: 'verify done' });
          return { status: 'verified' };
        },
        generate: async ({ reportProgress, params }) => {
          secondCalls.push('generate');
          assert.equal(params.generate, 3);
          assert.equal(params.marker, 'keep-me');
          reportProgress({ current: 1, total: 1, message: 'generate done' });
          return { status: 'generated' };
        }
      }
    });

    assert.deepEqual(firstCalls, ['mine']);
    assert.deepEqual(secondCalls, ['verify', 'generate']);
    assert.equal(result.runtimeStatus, 'completed');
    const runtime = readRuntimeState({ dataDir, runId: 'resume_run' });
    assert.equal(runtime.status, 'completed');
    assert.equal(runtime.mode, 'daily');
    assert.equal(runtime.params.verify, 7);
    assert.equal(runtime.params.marker, 'keep-me');
    assert.equal(runtime.progress.mine.status, 'completed');
    assert.equal(runtime.progress.verify.status, 'completed');
    assert.equal(runtime.progress.generate.status, 'completed');
  });

  it('clears stale platform blockers while retrying a blocked step', async () => {
    const dataDir = tempDataDir();
    const runId = 'retry_blocked_state';
    await runPipelineRuntime({
      dataDir,
      runId,
      mode: 'daily',
      steps: ['mine'],
      stepFns: {
        mine: async () => ({
          status: 'mining_manual_action_required',
          platform: 'sycm',
          manualAction: { status: 'slider_required', userMessage: '请完成滑块验证' }
        })
      }
    });

    let runningState = null;
    await runPipelineRuntime({
      dataDir,
      runId,
      mode: 'daily',
      preserveRuntime: true,
      retryStep: 'mine',
      steps: ['mine'],
      stepFns: {
        mine: async () => {
          runningState = readRuntimeState({ dataDir, runId });
          return { status: 'mined' };
        }
      }
    });

    assert.equal(runningState.status, 'running');
    assert.equal(runningState.platform, null);
    assert.equal(runningState.manualAction, null);
    assert.equal(runningState.error, null);
  });

  it('retries a selected step and resets downstream progress', async () => {
    const dataDir = tempDataDir();
    await runPipelineRuntime({
      dataDir,
      runId: 'retry_step_run',
      mode: 'daily',
      params: { mine: 1, verify: 5, generate: 2, marker: 'retry-params' },
      steps: ['mine', 'verify', 'generate'],
      stepFns: {
        mine: async () => ({ status: 'mined' }),
        verify: async () => ({ status: 'verified' }),
        generate: async () => ({ status: 'generated' })
      }
    });

    const calls = [];
    const result = await runPipelineRuntime({
      dataDir,
      runId: 'retry_step_run',
      mode: 'daily',
      preserveRuntime: true,
      retryStep: 'verify',
      steps: ['mine', 'verify', 'generate'],
      stepFns: {
        mine: async () => {
          calls.push('mine');
          throw new Error('mine should not rerun when retrying verify');
        },
        verify: async ({ reportProgress, params }) => {
          calls.push('verify');
          assert.equal(params.verify, 5);
          assert.equal(params.marker, 'retry-params');
          reportProgress({ current: 1, total: 1, message: 'verify retried' });
          return { status: 'verified' };
        },
        generate: async ({ reportProgress, params }) => {
          calls.push('generate');
          assert.equal(params.generate, 2);
          assert.equal(params.marker, 'retry-params');
          reportProgress({ current: 1, total: 1, message: 'generate rerun' });
          return { status: 'generated' };
        }
      }
    });

    assert.deepEqual(calls, ['verify', 'generate']);
    assert.equal(result.runtimeStatus, 'completed');
    const runtime = readRuntimeState({ dataDir, runId: 'retry_step_run' });
    assert.equal(runtime.status, 'completed');
    assert.equal(runtime.params.verify, 5);
    assert.equal(runtime.params.marker, 'retry-params');
    assert.equal(runtime.progress.mine.status, 'completed');
    assert.equal(runtime.progress.verify.status, 'completed');
    assert.equal(runtime.progress.generate.status, 'completed');
  });

  it('preserves generate_failed pipeline status and marks runtime failed', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['generate', 'export'],
      stepFns: {
        generate: async ({ reportProgress }) => {
          reportProgress({ current: 1, total: 1, message: 'generate failed' });
          return { status: 'generate_failed', blockers: ['no_products'] };
        },
        export: async () => {
          throw new Error('export should not run after generate_failed');
        }
      }
    });

    assert.equal(result.status, 'generate_failed');
    assert.equal(result.runtimeStatus, 'failed');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.status, 'failed');
    assert.ok(readRuntimeEvents({ dataDir, runId: result.runId }).some(event => {
      return event.event === 'status' && event.status === 'failed' && event.pipelineStatus === 'generate_failed';
    }));
  });

  it('preserves manual_action_required pipeline status and marks runtime blocked', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['verify', 'generate'],
      stepFns: {
        verify: async ({ reportProgress }) => {
          reportProgress({ current: 1, total: 1, message: 'manual input needed' });
          return { status: 'manual_action_required', blockers: ['sycm_manual_required'] };
        },
        generate: async () => {
          throw new Error('generate should not run after manual_action_required');
        }
      }
    });

    assert.equal(result.status, 'manual_action_required');
    assert.equal(result.runtimeStatus, 'blocked');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.status, 'blocked');
  });

  it('preserves verified_empty pipeline status and marks runtime blocked', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['verify', 'generate'],
      stepFns: {
        verify: async ({ reportProgress }) => {
          reportProgress({ current: 1, total: 1, message: 'no verified keywords' });
          return { status: 'verified_empty', verified: [], rejected: [] };
        },
        generate: async () => {
          throw new Error('generate should not run after verified_empty');
        }
      }
    });

    assert.equal(result.status, 'verified_empty');
    assert.equal(result.runtimeStatus, 'blocked');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.status, 'blocked');
  });

  it('preserves needs_review pipeline status and marks runtime needs_review', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['review'],
      stepFns: {
        review: async ({ reportProgress }) => {
          reportProgress({ current: 1, total: 1, message: 'review required' });
          return { status: 'needs_review', mustReview: true };
        }
      }
    });

    assert.equal(result.status, 'needs_review');
    assert.equal(result.runtimeStatus, 'needs_review');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.status, 'needs_review');
  });

  it('preserves ready_to_distribute pipeline status and marks runtime needs_review', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['export', 'review'],
      stepFns: {
        export: async ({ reportProgress }) => {
          reportProgress({ current: 1, total: 1, message: 'distribution ready' });
          return { status: 'ready_to_distribute', canSubmit: true };
        },
        review: async () => {
          throw new Error('review should not run after ready_to_distribute');
        }
      }
    });

    assert.equal(result.status, 'ready_to_distribute');
    assert.equal(result.runtimeStatus, 'needs_review');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.status, 'needs_review');
  });

  it('marks runtime blocked when a step returns platform manual action status', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      runId: 'platform-blocked-test',
      mode: 'manual',
      dataDir,
      steps: ['verify'],
      stepFns: {
        verify: async () => ({
          status: 'manual_action_required',
          platform: 'taobao',
          manualAction: { status: 'slider_required', userMessage: '淘宝需要滑块验证' }
        })
      }
    });

    assert.equal(result.status, 'manual_action_required');
    assert.equal(result.runtimeStatus, 'blocked');
  });
});
