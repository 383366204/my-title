'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 创建服务实例内的铺货任务存储与终态同步服务。
 * @param {object} deps 数据目录、确认读取器及工作流访问依赖。
 * @returns {object} 共享任务容器和读写、核对、完成同步方法。
 */
function createDistributionJobs({ jobDir, getConfirmationReader, summarizePipelineRun, readRuntimeState, markRunDistributionComplete, updateRuntimeState, appendRuntimeEvent }) {
  const DISTRIBUTION_JOB_DIR = jobDir;
  const activeDistributionJobs = new Map();

  function distributionJobFile(jobId) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(jobId || ''))) throw new Error('无效的铺货运行 ID。');
    return path.join(DISTRIBUTION_JOB_DIR, `${jobId}.json`);
  }

  function readDistributionJob(jobId) {
    const file = distributionJobFile(jobId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  }

  function writeDistributionJob(job) {
    fs.mkdirSync(DISTRIBUTION_JOB_DIR, { recursive: true });
    fs.writeFileSync(distributionJobFile(job.jobId), `${JSON.stringify(job, null, 2)}\n`, 'utf8');
    return job;
  }

  function updateDistributionJob(jobId, patch = {}) {
    const current = activeDistributionJobs.get(jobId) || readDistributionJob(jobId) || {};
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    activeDistributionJobs.set(jobId, next);
    return writeDistributionJob(next);
  }

  function distributionJobInput(job = {}) {
    return (job.items || []).map(item => (
      `${item.url || ''}$$${item.title || ''}$$${item.category || ''}`
    )).join('\n');
  }

  async function recheckDistributionJob(job) {
    const input = distributionJobInput(job);
    if (!input) throw new Error('铺货任务没有可复核的商品清单。');
    const reader = getConfirmationReader();
    updateDistributionJob(job.jobId, {
      status: 'checking_confirmation',
      confirmationError: '',
      progress: { ...(job.progress || {}), phase: 'checking_confirmation' }
    });
    try {
      const confirmationCheck = await reader({ input });
      const completed = confirmationCheck?.ok === true && confirmationCheck?.status === 'confirmed';
      const next = updateDistributionJob(job.jobId, {
        status: completed ? 'completed' : 'completed_with_issues',
        completed: completed ? Number(job.total || 0) : Number(job.completed || 0),
        failed: completed ? 0 : Number(job.failed || 0),
        confirmationCheck,
        confirmationError: '',
        progress: { ...(job.progress || {}), phase: completed ? 'completed' : 'completed_with_issues' }
      });
      if (completed && next.workflowRunId) {
        syncCompletedDistributionWorkflow({
          ...next,
          result: { ...(next.result || {}), total: next.total, confirmed: next.total, confirmationCheck }
        });
      }
      return next;
    } catch (error) {
      updateDistributionJob(job.jobId, {
        status: 'completed_with_issues',
        confirmationError: error.message,
        progress: { ...(job.progress || {}), phase: 'confirmation_failed' }
      });
      throw error;
    }
  }

  function syncCompletedDistributionWorkflow(job) {
    if (!job || job.status !== 'completed' || !job.workflowRunId) return;
    const currentSummary = summarizePipelineRun({ runId: job.workflowRunId });
    const currentRuntime = readRuntimeState({ runId: job.workflowRunId });
    if (currentSummary?.status === 'workflow_complete' && currentRuntime?.status === 'completed') return;
    markRunDistributionComplete({
      runId: job.workflowRunId,
      distributionResult: { ...(job.result || {}), method: job.mode || job.result?.method || 'automatic' }
    });
    const runtime = currentRuntime || readRuntimeState({ runId: job.workflowRunId });
    if (!runtime) return;
    updateRuntimeState({
      runId: job.workflowRunId,
      patch: {
        status: 'completed',
        activeStep: 'end',
        progress: {
          ...(runtime.progress || {}),
          export: {
            status: 'completed',
            current: 1,
            total: 1,
            percent: 100,
            message: job.mode === 'manual' ? '人工铺货已确认' : '铺货已确认'
          },
          end: { status: 'completed', current: 1, total: 1, percent: 100, message: '流程完成' }
        },
        requestedAction: null
      }
    });
    appendRuntimeEvent({
      runId: job.workflowRunId,
      event: { event: 'status', status: 'completed', pipelineStatus: 'workflow_complete', step: 'end' }
    });
  }

  return { activeDistributionJobs, readDistributionJob, writeDistributionJob, updateDistributionJob, recheckDistributionJob, syncCompletedDistributionWorkflow };
}

module.exports = { createDistributionJobs };
