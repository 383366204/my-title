'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  STAGE_ORDER,
  pipelineStatusToStage,
  summarizePipelineRun,
  listPipelineRuns,
  readJsonlPreview,
  readTextPreview,
  countNonEmptyLines
} = require('../pipeline-run-summary');

function tempPipelineDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-summary-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function writeText(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, 'utf8');
}

describe('pipeline run summary', () => {
  it('maps pipeline statuses to normalized stages', () => {
    assert.deepEqual(STAGE_ORDER, ['seed', 'mined', 'keyword_review', 'verified', 'selected', 'generated', 'review', 'ready', 'submitted']);
    assert.equal(pipelineStatusToStage('created'), 'seed');
    assert.equal(pipelineStatusToStage('mined'), 'mined');
    assert.equal(pipelineStatusToStage('awaiting_keyword_review'), 'keyword_review');
    assert.equal(pipelineStatusToStage('keywords_reviewed'), 'keyword_review');
    assert.equal(pipelineStatusToStage('keyword_review_empty'), 'keyword_review');
    assert.equal(pipelineStatusToStage('manual_action_required'), 'verified');
    assert.equal(pipelineStatusToStage('verified_partial_manual_required'), 'verified');
    assert.equal(pipelineStatusToStage('verified'), 'verified');
    assert.equal(pipelineStatusToStage('verified_empty'), 'verified');
    assert.equal(pipelineStatusToStage('products_selected'), 'selected');
    assert.equal(pipelineStatusToStage('select_failed'), 'selected');
    assert.equal(pipelineStatusToStage('generated'), 'generated');
    assert.equal(pipelineStatusToStage('generate_failed'), 'generated');
    assert.equal(pipelineStatusToStage('needs_review'), 'review');
    assert.equal(pipelineStatusToStage('ready_to_distribute'), 'ready');
    assert.equal(pipelineStatusToStage('export_empty'), 'review');
    assert.equal(pipelineStatusToStage('awaiting_user_confirmation'), 'ready');
    assert.equal(pipelineStatusToStage('workflow_complete'), 'submitted');
    assert.equal(pipelineStatusToStage('unknown'), 'seed');
    assert.equal(pipelineStatusToStage('not_real'), 'seed');
  });

  it('summarizes a needs_review run with previews and review blockers', () => {
    const dataDir = tempPipelineDir();
    const runId = 'review_run';
    const runDir = path.join(dataDir, 'runs', runId);
    const files = {
      candidates: path.join(runDir, 'candidates.jsonl'),
      verifiedKeywords: path.join(runDir, 'verified-keywords.jsonl'),
      generatedProducts: path.join(runDir, 'generated-products.jsonl'),
      distributionBatch: path.join(runDir, 'distribution-batch.txt'),
      distributionReview: path.join(runDir, 'distribution-review.md')
    };
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'needs_review',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: {
        candidates: 2,
        sycmVerified: 1,
        sycmRejected: 1,
        generatedProducts: 1,
        readyToDistribute: 1,
        reviewCandidates: 1,
        rejectedBeforeDistribution: 1
      },
      files
    });
    writeText(files.candidates, '{"keyword":"pet bed"}\n{"keyword":"cat bowl"}\n');
    writeText(files.verifiedKeywords, '{"keyword":"pet bed","status":"verified"}\n');
    writeText(files.generatedProducts, '{"title":"Warm pet bed","status":"generated"}\n');
    writeText(files.distributionBatch, 'https://detail.1688.com/offer/1.html\tWarm pet bed\n');
    writeText(files.distributionReview, '# Review\nneeds manual check\n');

    const summary = summarizePipelineRun({ dataDir, runId, previewLimit: 1, reviewChars: 40 });

    assert.equal(summary.ok, true);
    assert.equal(summary.runId, runId);
    assert.equal(summary.status, 'needs_review');
    assert.equal(summary.stage, 'review');
    assert.equal(summary.stageIndex, 6);
    assert.deepEqual(summary.counts, {
      candidates: 2,
      sycmVerified: 1,
      sycmRejected: 1,
      generatedProducts: 1,
      readyToDistribute: 1,
      reviewCandidates: 1,
      rejectedBeforeDistribution: 1
    });
    assert.equal(summary.batchCount, 1);
    assert.equal(summary.batchFile, files.distributionBatch);
    assert.equal(summary.reviewFile, files.distributionReview);
    assert.equal(summary.batchExists, true);
    assert.equal(summary.reviewExists, true);
    assert.equal(summary.mustReview, true);
    assert.equal(summary.nextActionCode, 'review_required');
    assert.equal(summary.requiresUserAction, true);
    assert.deepEqual(summary.blockers, ['review_rejected_rows']);
    assert.deepEqual(summary.previews.candidates, [{ keyword: 'pet bed' }]);
    assert.deepEqual(summary.previews.verifiedKeywords, [{ keyword: 'pet bed', status: 'verified' }]);
    assert.deepEqual(summary.previews.generatedProducts, [{ title: 'Warm pet bed', status: 'generated' }]);
    assert.match(summary.previews.distributionReview, /needs manual check/);
  });

  it('marks manual-action verification runs as user-action blockers', () => {
    const dataDir = tempPipelineDir();
    const runId = 'manual_run';
    writeJson(path.join(dataDir, 'runs', runId, 'run.json'), {
      runId,
      status: 'verified_partial_manual_required',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: {},
      files: {}
    });

    const summary = summarizePipelineRun({ dataDir, runId });

    assert.equal(summary.stage, 'verified');
    assert.equal(summary.nextActionCode, 'manual_action_required');
    assert.equal(summary.requiresUserAction, true);
    assert.deepEqual(summary.blockers, ['sycm_manual_action_required']);
  });

  it('falls back when persisted file paths escape the run directory', () => {
    const dataDir = tempPipelineDir();
    const runId = 'path_escape_run';
    const runDir = path.join(dataDir, 'runs', runId);
    const outsideDir = path.join(dataDir, 'outside');
    const outsideCandidates = path.join(outsideDir, 'candidates.jsonl');
    const outsideReview = path.join(outsideDir, 'distribution-review.md');
    writeText(outsideCandidates, '{"keyword":"leaked"}\n');
    writeText(outsideReview, 'external review content\n');
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'needs_review',
      updatedAt: '2026-06-29T04:10:00.000Z',
      files: {
        candidates: outsideCandidates,
        distributionReview: outsideReview
      }
    });

    const summary = summarizePipelineRun({ dataDir, runId });

    assert.equal(summary.files.candidates, path.join(runDir, 'candidates.jsonl'));
    assert.equal(summary.files.distributionReview, path.join(runDir, 'distribution-review.md'));
    assert.deepEqual(summary.previews.candidates, []);
    assert.equal(summary.previews.distributionReview, '');
  });

  it('returns safe fallbacks when preview helpers receive an unreadable directory path', () => {
    const dataDir = tempPipelineDir();

    assert.deepEqual(readJsonlPreview(dataDir, 2), []);
    assert.equal(readTextPreview(dataDir, 20), '');
    assert.equal(countNonEmptyLines(dataDir), 0);
    assert.deepEqual(readJsonlPreview(path.join(dataDir, 'missing.jsonl'), 2), []);
    assert.equal(readTextPreview(path.join(dataDir, 'missing.md'), 20), '');
    assert.equal(countNonEmptyLines(path.join(dataDir, 'missing.txt')), 0);
  });

  it('rejects invalid run ids before reading files', () => {
    assert.throws(
      () => summarizePipelineRun({ dataDir: tempPipelineDir(), runId: '../secret' }),
      /Invalid runId/
    );
  });

  it('skips malformed JSONL lines while reading previews', () => {
    const dataDir = tempPipelineDir();
    const file = path.join(dataDir, 'sample.jsonl');
    writeText(file, '{"ok":1}\nnot json\n\n{"ok":2}\n{"ok":3}\n');

    assert.deepEqual(readJsonlPreview(file, 2), [{ ok: 1 }, { ok: 2 }]);
  });

  it('lists runs by updatedAt descending then runId descending', () => {
    const dataDir = tempPipelineDir();
    writeJson(path.join(dataDir, 'runs', 'old', 'run.json'), {
      runId: 'old',
      status: 'mined',
      updatedAt: '2026-06-28T00:00:00.000Z'
    });
    writeJson(path.join(dataDir, 'runs', 'z_same_time', 'run.json'), {
      runId: 'z_same_time',
      status: 'generated',
      updatedAt: '2026-06-29T00:00:00.000Z'
    });
    writeJson(path.join(dataDir, 'runs', 'a_same_time', 'run.json'), {
      runId: 'a_same_time',
      status: 'ready_to_distribute',
      updatedAt: '2026-06-29T00:00:00.000Z',
      counts: { readyToDistribute: 1 }
    });

    const result = listPipelineRuns({ dataDir });

    assert.deepEqual(result.runs.map(run => run.runId), ['z_same_time', 'a_same_time', 'old']);
    assert.equal(result.latest.runId, 'z_same_time');
  });
});
