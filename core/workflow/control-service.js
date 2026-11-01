'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareKeywordSupplement } = require('../../skills/pipeline-flow/src/keyword-supplement');
const { getRun: getPipelineRun } = require('../../skills/pipeline-flow/src/run-store');
const { readWorkflowNodeArtifact } = require('./pipeline-artifacts');
const { getKeywordRecollectionRoots } = require('../server/keyword-filter-routes');
const { saveInspirationRoots } = require('../../skills/pipeline-flow/src/inspiration-root-review');
const { isValidStepForMode } = require('./pipeline-definition-common');

const LAUNCH_VALIDATION_PATTERN = /未知 workflow mode|未知 workflow template|工作流定义|工作流必须匹配|关键词不能为空|词根不能为空|1688 商品链接|同行链接|商品缺少关键词|商品重复/;

const PIPELINE_STEP_ALLOWLIST = new Set([
  'inspire',
  'mine',
  'review',
  'keywordReview',
  'verify',
  'select',
  'generate',
  'export'
]);

const WORKFLOW_RETRY_NODE_ALLOWLIST = new Set([
  'start',
  'inspire',
  'mine',
  'keywordReview',
  'verify',
  'select',
  'generate',
  'export',
  'collectRank',
  'generateSheet',
  'resolveShops',
  'collectCompetitors',
  'enrichCompetitors',
  'analyzeCompetitors',
  'competitorReport'
]);

const PEER_DISCOVERY_RETRY_NODE_ALLOWLIST = new Set([
  'extractSources',
  'findSimilarProducts',
  'evaluateShops',
  'peerReport',
  'collectPeerProducts',
  'verifyImageSources',
  'prepareListingDrafts',
  'peerProductReport'
]);

/**
 * 判断工作流节点在当前 runtime 下是否允许重试。
 * @param {object} runtime 当前运行状态。
 * @param {string} nodeId 节点 ID。
 * @returns {boolean}
 */
function isWorkflowRetryNodeAllowed(runtime, nodeId) {
  const steps = Array.isArray(runtime?.steps) ? runtime.steps : [];
  const sourcingRetryAllowed = runtime?.mode === 'competitor-analysis'
    && nodeId === 'findCompetitorSources'
    && steps.includes(nodeId);
  const peerRetryAllowed = sourcingRetryAllowed || (
    runtime?.mode === 'peer-discovery'
    && steps.includes(nodeId)
    && PEER_DISCOVERY_RETRY_NODE_ALLOWLIST.has(nodeId)
  );
  return peerRetryAllowed || WORKFLOW_RETRY_NODE_ALLOWLIST.has(nodeId);
}

/**
 * 创建统一的工作流控制应用服务（收拢 pipeline-routes 与 workflow-control-routes 的控制逻辑）。
 * @param {object} dependencies 依赖项。
 * @returns {object} 工作流控制服务实例。
 */
function createWorkflowControlService(dependencies = {}) {
  const {
    validateProductionWorkflow,
    workbench,
    isValidWorkflowRunIdParam = (value) => Boolean(value) && /^[A-Za-z0-9_-]+$/.test(String(value).trim()),
    requestRuntimeCancel,
    readRuntimeState,
    getPipelineRuntimeRunner,
    prepareSupplement = prepareKeywordSupplement,
    parsePositiveNumber = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : fallback;
    },
    getSycmChromeAvailabilityChecker,
    recoverSycmAccessAfterChrome,
    requestRuntimeRetryStep,
    pipelineRunResponse,
    retryWorkflowNode,
    getRun,
    requestRuntimeResume,
    resumeWorkflow,
    requestRuntimePause,
    markRunPaused,
    resolveProductionWorkflowLaunch,
    resolveManualShareParams = async (_mode, params) => params,
    sanitizeWorkflowParams,
    createRunId,
    resolveProductionWorkflowDefinition,
    writeWorkflowDefinition,
    listPipelineRuns,
    summarizePipelineRun,
    withPipelineRuntimeFields = (value) => value,
    appendRunCandidates,
    runPipelineStep,
    originalLog = () => {},
    originalError = () => {},
    isValidStepForMode: defaultIsValidStepForMode = isValidStepForMode,
    dataDir
  } = dependencies;

  /**
   * 启动新的生产工作流运行（在异步参数解析前预占 workbench 锁）。
   * @param {object} body 请求体。
   * @param {object} [options] 启动选项。
   * @param {'workflow'|'pipeline'} [options.source='workflow'] 调用来源标识。
   * @returns {Promise<{httpStatus:number, body:object}>}
   */
  async function startRun(body = {}, options = {}) {
    const source = options.source || 'workflow';
    const logLabel = source === 'pipeline' ? 'Pipeline Start' : 'Workflow Run';
    const runState = workbench.tryAcquire({ mode: 'preparing' });
    if (!runState) {
      return {
        httpStatus: 409,
        body: {
          ok: false,
          status: 'workflow_busy',
          error: '已有工作流正在运行，请等待完成后再启动。'
        }
      };
    }

    try {
      const launch = resolveProductionWorkflowLaunch(body || {});
      const stopAfterStep = body.stopAfterStep || body.params?.stopAfterStep || options.stopAfterStep || launch.params?.stopAfterStep || null;
      if (stopAfterStep && !defaultIsValidStepForMode(launch.mode, stopAfterStep, { discoveryBranch: launch.params?.discoveryBranch })) {
        workbench.release(runState);
        return {
          httpStatus: 400,
          body: {
            ok: false,
            error: `指定的 stopAfterStep '${stopAfterStep}' 不是 ${launch.mode} 模式的有效步骤。`
          }
        };
      }
      const resolvedParams = await resolveManualShareParams(launch.mode, launch.params);
      const params = sanitizeWorkflowParams(launch.mode, resolvedParams);
      if (stopAfterStep) params.stopAfterStep = stopAfterStep;
      const runId = createRunId();
      const definition = resolveProductionWorkflowDefinition(body || {}, launch);
      writeWorkflowDefinition({ runId, definition });
      Object.assign(runState, { runId, mode: launch.mode });
      const promise = workbench.runReserved(runState, () => getPipelineRuntimeRunner()({
        runId,
        mode: launch.mode,
        params,
        ...(stopAfterStep ? { stopAfterStep } : {})
      }));

      promise.then((result) => {
        originalLog(`[${logLabel}] ${launch.mode} runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
      }).catch((err) => {
        originalError(`[${logLabel}] ${launch.mode} runtime 失败，runId=${runId}:`, err.message);
      });

      if (source === 'pipeline') {
        return {
          httpStatus: 200,
          body: {
            ok: true,
            data: {
              status: 'started',
              runId,
              mode: launch.mode,
              runtime: readRuntimeState({ runId }),
              currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
            }
          }
        };
      }

      return {
        httpStatus: 200,
        body: {
          ok: true,
          data: {
            status: 'started',
            runId,
            mode: launch.mode,
            monitor: 'workflow',
            message: `真实 workflow runtime 已启动，runId=${runId}。`
          }
        }
      };
    } catch (err) {
      const isValidationErr = (source === 'workflow' && err instanceof TypeError)
        || LAUNCH_VALIDATION_PATTERN.test(err.message);
      return {
        httpStatus: isValidationErr ? 400 : 500,
        body: { ok: false, error: err.message }
      };
    } finally {
      if (!runState.promise) workbench.release(runState);
    }
  }

  /**
   * 暂停指定运行。
   * @param {object} options 暂停参数。
   * @param {string} options.runId 运行 ID。
   * @param {string} [options.reason] 暂停原因。
   * @param {boolean} [options.validateRunId=false] 是否校验 runId 格式。
   * @param {boolean} [options.allowLegacyFallback=false] 是否回退旧 run-store。
   * @returns {{httpStatus:number, body:object}}
   */
  function pauseRun({ runId, reason, validateRunId = false, allowLegacyFallback = false }) {
    if (validateRunId && !isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    try {
      const runtime = readRuntimeState({ runId });
      if (runtime) {
        const control = requestRuntimePause({
          runId,
          reason: reason || 'user_paused'
        });
        return {
          httpStatus: 200,
          body: { ok: true, data: pipelineRunResponse(runId, { control }) }
        };
      }
      if (allowLegacyFallback) {
        const run = markRunPaused(runId);
        if (!run) {
          return { httpStatus: 404, body: { ok: false, error: '工作流运行不存在' } };
        }
        return { httpStatus: 200, body: { ok: true, run } };
      }
      return { httpStatus: 404, body: { ok: false, error: '未找到该流程运行记录' } };
    } catch (err) {
      return {
        httpStatus: allowLegacyFallback ? 400 : 500,
        body: { ok: false, error: err.message }
      };
    }
  }

  /**
   * 继续执行暂停的工作流。
   * @param {object} options 恢复参数。
   * @param {string} options.runId 运行 ID。
   * @param {boolean} [options.validateRunId=false] 是否先校验 runId 格式。
   * @param {boolean} [options.allowLegacyFallback=false] 是否允许回退旧 scheduler。
   * @param {'workflow'|'pipeline'} [options.source='workflow'] 调用来源。
   * @returns {Promise<{httpStatus:number, body:object}>}
   */
  async function resumeRun({ runId, validateRunId = false, allowLegacyFallback = false, source = 'workflow', stopAfterStep = null }) {
    if (validateRunId && !isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    if (source === 'pipeline' && workbench.current) {
      return {
        httpStatus: 409,
        body: { ok: false, error: '已有工作流正在运行，请等待完成后再继续。' }
      };
    }
    const logLabel = source === 'pipeline' ? 'Pipeline Resume' : 'Workflow Resume';
    const modeTag = source === 'pipeline' ? 'resume' : 'workflow-resume';
    try {
      const runtime = readRuntimeState({ runId });
      if (runtime) {
        if (workbench.current) {
          return {
            httpStatus: 409,
            body: { ok: false, error: '已有工作流正在运行，请等待完成后再继续。' }
          };
        }
        const control = requestRuntimeResume({ runId });
        const runState = { runId, mode: modeTag };
        const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
          runId,
          mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
          params: runtime.params || {},
          preserveRuntime: true,
          resumeFromStep: runtime.activeStep,
          steps: runtime.steps,
          ...(stopAfterStep ? { stopAfterStep } : {})
        }));
        promise.then((result) => {
          originalLog(`[${logLabel}] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
        }).catch((err) => {
          originalError(`[${logLabel}] runtime 失败，runId=${runId}:`, err.message);
        });
        return {
          httpStatus: 200,
          body: { ok: true, data: pipelineRunResponse(runId, { control }) }
        };
      }
      if (allowLegacyFallback) {
        if (workbench.current) {
          return {
            httpStatus: 409,
            body: { ok: false, error: '已有工作流正在运行，请等待完成后再继续。' }
          };
        }
        await workbench.run({ runId, mode: 'legacy-resume' }, () => resumeWorkflow(runId));
        return { httpStatus: 200, body: { ok: true, run: getRun(runId) } };
      }
      return { httpStatus: 404, body: { ok: false, error: '未找到该流程运行记录' } };
    } catch (err) {
      return {
        httpStatus: allowLegacyFallback ? 400 : 500,
        body: { ok: false, error: err.message }
      };
    }
  }

  /**
   * 重试指定节点或步骤。
   * @param {object} options 重试参数。
   * @param {string} options.runId 运行 ID。
   * @param {string} options.stepId 步骤或节点 ID。
   * @param {'workflow'|'pipeline'} [options.source='workflow'] 调用来源。
   * @param {boolean} [options.allowLegacyFallback=false] 是否允许回退旧 scheduler。
   * @returns {Promise<{httpStatus:number, body:object}>}
   */
  async function retryStep({ runId, stepId, source = 'workflow', allowLegacyFallback = false }) {
    if (source === 'pipeline') {
      if (!isValidWorkflowRunIdParam(runId)) {
        return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
      }
      const step = String(stepId || '');
      if (!PIPELINE_STEP_ALLOWLIST.has(step)) {
        return { httpStatus: 400, body: { ok: false, error: '不支持的流程步骤。' } };
      }
      if (workbench.current) {
        return {
          httpStatus: 409,
          body: { ok: false, error: '已有工作流正在运行，请等待完成后再重试。' }
        };
      }
      try {
        const runtime = readRuntimeState({ runId });
        if (!runtime) {
          return { httpStatus: 404, body: { ok: false, error: '未找到该流程运行记录' } };
        }
        const control = requestRuntimeRetryStep({ runId, step });
        const runState = { runId, mode: 'retry-step' };
        const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
          runId,
          mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
          params: runtime.params || {},
          preserveRuntime: true,
          retryStep: step,
          steps: runtime.steps
        }));
        promise.then((result) => {
          originalLog(`[Pipeline Retry] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
        }).catch((err) => {
          originalError(`[Pipeline Retry] runtime 失败，runId=${runId}, step=${step}:`, err.message);
        });
        return {
          httpStatus: 200,
          body: { ok: true, data: pipelineRunResponse(runId, { control }) }
        };
      } catch (err) {
        return { httpStatus: 500, body: { ok: false, error: err.message } };
      }
    }

    try {
      const nodeId = String(stepId || '').trim();
      if (!nodeId) {
        return { httpStatus: 400, body: { ok: false, error: 'nodeId is required' } };
      }
      const runtime = readRuntimeState({ runId });
      if (runtime) {
        if (!isWorkflowRetryNodeAllowed(runtime, nodeId)) {
          return { httpStatus: 400, body: { ok: false, error: '不支持的流程步骤。' } };
        }
        const manualOrderSheetCollection = nodeId === 'collectRank'
          && runtime.mode === 'order-sheet'
          && runtime.params?.inputMode === 'manual';
        if (nodeId === 'verify' || nodeId === 'collectRank' || (nodeId === 'mine' && ['root-keyword', 'daily'].includes(runtime.mode))) {
          const port = parsePositiveNumber(runtime.params?.port || process.env.SYCM_DEBUG_PORT || 9222, 9222);
          if (manualOrderSheetCollection) {
            const chromeReady = await getSycmChromeAvailabilityChecker()(port);
            if (!chromeReady) {
              return {
                httpStatus: 409,
                body: {
                  ok: false,
                  code: 'CHROME_REQUIRED',
                  error: `Chrome 调试连接仍不可用（端口 ${port}）。请先点击节点上的“启动 Chrome”，登录淘宝后再重试获取商品资料。`
                }
              };
            }
          } else {
            const recovery = await recoverSycmAccessAfterChrome(port);
            if (!recovery.chromeReady) {
              return {
                httpStatus: 409,
                body: {
                  ok: false,
                  code: 'SYCM_CHROME_REQUIRED',
                  error: `Chrome 调试连接仍不可用（端口 ${port}）。请先点击节点上的“启动 Chrome”，完成登录后再重试当前节点。`
                }
              };
            }
          }
        }
        if (workbench.current) {
          return {
            httpStatus: 409,
            body: { ok: false, error: '已有工作流正在运行，请等待完成后再重试。' }
          };
        }
        const control = requestRuntimeRetryStep({ runId, step: nodeId });
        const runState = { runId, mode: 'workflow-retry-step' };
        const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
          runId,
          mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
          params: runtime.params || {},
          preserveRuntime: true,
          retryStep: nodeId,
          steps: runtime.steps
        }));
        promise.then((result) => {
          originalLog(`[Workflow Retry] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
        }).catch((err) => {
          originalError(`[Workflow Retry] runtime 失败，runId=${runId}, step=${nodeId}:`, err.message);
        });
        return {
          httpStatus: 200,
          body: { ok: true, data: pipelineRunResponse(runId, { control }) }
        };
      }
      if (allowLegacyFallback) {
        if (workbench.current) {
          return {
            httpStatus: 409,
            body: { ok: false, error: '已有工作流正在运行，请等待完成后再重试。' }
          };
        }
        await workbench.run({ runId, mode: 'legacy-retry' }, () => retryWorkflowNode(runId, nodeId));
        return { httpStatus: 200, body: { ok: true, run: getRun(runId) } };
      }
      return { httpStatus: 404, body: { ok: false, error: '未找到该流程运行记录' } };
    } catch (err) {
      return { httpStatus: 400, body: { ok: false, error: err.message } };
    }
  }

  /**
   * 请求在安全边界取消运行。
   * @param {object} options 取消参数。
   * @param {string} options.runId 运行 ID。
   * @param {string} [options.reason] 取消原因。
   * @returns {{httpStatus:number, body:object}}
   */
  function cancelRun({ runId, reason }) {
    if (!isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    try {
      const control = requestRuntimeCancel({
        runId,
        reason: reason || 'user_cancelled'
      });
      return {
        httpStatus: 200,
        body: { ok: true, data: { runId, status: 'cancel_requested', control } }
      };
    } catch (err) {
      const httpStatus = /Invalid runtime run id/.test(err.message) ? 400 : 500;
      return { httpStatus, body: { ok: false, error: err.message } };
    }
  }

  /**
   * 校验生产工作流定义。
   * @param {object} body 请求体。
   * @returns {{httpStatus:number, body:object}}
   */
  function validateWorkflowDefinition(body = {}) {
    try {
      const result = validateProductionWorkflow(body.workflow, {
        templateId: body.templateId || body.template_id,
        mode: body.mode
      });
      return {
        httpStatus: result.ok ? 200 : 400,
        body: { ok: result.ok, data: result }
      };
    } catch (err) {
      return { httpStatus: 500, body: { ok: false, error: err.message } };
    }
  }

  /**
   * 更新灵感词根复核内容。
   * @param {object} options 参数。
   * @param {string} options.runId 运行 ID。
   * @param {string} [options.rootsText] 词根文本。
   * @param {number} [options.revision] 版本号。
   * @returns {{httpStatus:number, body:object}}
   */
  function updateInspirationRoots({ runId, rootsText, revision }) {
    if (!isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID' } };
    }
    if (workbench?.current) {
      return { httpStatus: 409, body: { ok: false, error: '请先暂停运行' } };
    }
    try {
      const result = saveInspirationRoots({ runId, dataDir, rootsText, revision });
      return { httpStatus: 200, body: { ok: true, data: result } };
    } catch (error) {
      return { httpStatus: 409, body: { ok: false, error: error.message } };
    }
  }

  /**
   * 关键词过滤阶段发起隔离重采。
   * @param {object} options 参数。
   * @param {string} options.runId 源运行 ID。
   * @param {number} [options.version] 过滤配置版本。
   * @param {object} [options.decisions] 人工决策映射。
   * @returns {{httpStatus:number, body:object}}
   */
  function recollectKeywordFilter({ runId: sourceRunId, version, decisions: suppliedDecisionsInput }) {
    if (!isValidWorkflowRunIdParam(sourceRunId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    const runtime = readRuntimeState({ runId: sourceRunId });
    if (!runtime || runtime.activeStep !== 'keywordReview' || !['blocked', 'paused', 'needs_review'].includes(runtime.status)
      || runtime.progress?.keywordReview?.status === 'completed') {
      return { httpStatus: 409, body: { ok: false, error: '请在待确认关键词阶段发起重采。' } };
    }
    if (!['daily', 'keyword', 'root-keyword'].includes(runtime.mode)) {
      return { httpStatus: 409, body: { ok: false, code: 'RECOLLECTION_UNSUPPORTED', error: '该模式不支持重采。' } };
    }
    const reservation = workbench.tryAcquire({ mode: 'keyword-recollect' });
    if (!reservation) {
      return { httpStatus: 409, body: { ok: false, error: '已有工作流正在运行。' } };
    }
    let receipt;
    let dispatched = false;
    let createdReceipt = false;
    try {
      const { run, runDir } = getPipelineRun({ runId: sourceRunId, dataDir });
      if (!['awaiting_keyword_review', 'keyword_review_empty'].includes(run.status)
        || version !== (run.options?.keywordFilterVersion || 0)) {
        return { httpStatus: 409, body: { ok: false, error: '筛选配置或运行状态已更新，请刷新。' } };
      }
      const rows = readWorkflowNodeArtifact({ runId: sourceRunId, dataDir, nodeId: 'keywordReview', limit: 'all' })?.rows || [];
      const suppliedDecisions = suppliedDecisionsInput === undefined ? {} : suppliedDecisionsInput;
      const knownKeywords = new Set(rows.map((row) => row.keyword));
      if (!suppliedDecisions || typeof suppliedDecisions !== 'object' || Array.isArray(suppliedDecisions)
        || Object.entries(suppliedDecisions).some(([keyword, value]) => !knownKeywords.has(keyword)
          || !['approved', 'rejected'].includes(value))) {
        return { httpStatus: 400, body: { ok: false, error: 'decisions 必须是已有关键词到 approved/rejected 的映射。' } };
      }
      receipt = path.join(runDir, `keyword-filter-recollection-${version}.json`);
      if (fs.existsSync(receipt)) {
        return {
          httpStatus: 200,
          body: { ok: true, data: { ...JSON.parse(fs.readFileSync(receipt, 'utf8')), reused: true } }
        };
      }
      const mode = runtime.mode === 'daily' ? 'root-keyword' : runtime.mode;
      const roots = runtime.mode === 'daily' ? getKeywordRecollectionRoots(run) : null;
      if (roots && !roots.length) {
        return {
          httpStatus: 409,
          body: { ok: false, code: 'RECOLLECTION_UNSUPPORTED', error: '未记录实际查询词根，无法安全重采；不会重新生成灵感。' }
        };
      }
      const decisions = {
        ...Object.fromEntries(rows.filter((row) => ['approved', 'rejected'].includes(row.reviewDraft || row.reviewStatus))
          .map((row) => [row.keyword, row.reviewDraft || row.reviewStatus])),
        ...suppliedDecisions
      };
      const params = {
        ...sanitizeWorkflowParams(mode, {
          ...run.options,
          ...runtime.params,
          ...(mode === 'keyword' && rows.length ? { keywords: rows.map((row) => row.keyword) } : {}),
          ...(roots ? { roots, sycmMode: 'both', pages: runtime.params?.inspirationSycmPages || 3 } : {}),
          keywordFilter: run.options.keywordFilter
        }),
        guardCache: false,
        keywordFilterDecisions: decisions,
        recollectionOf: sourceRunId
      };
      const runId = `${createRunId()}-recollect-${crypto.randomUUID().slice(0, 8)}`;
      writeWorkflowDefinition({ runId, definition: resolveProductionWorkflowDefinition({ mode }, { mode, params }) });
      const response = {
        runId,
        sourceRunId,
        status: 'started',
        mode,
        recollectionMode: 'new_run',
        keywordFilterVersion: 0,
        cacheBypassed: true
      };
      fs.writeFileSync(receipt, JSON.stringify(response), { flag: 'wx' });
      createdReceipt = true;
      Object.assign(reservation, { runId });
      const promise = workbench.runReserved(reservation, () => getPipelineRuntimeRunner()({
        runId,
        mode,
        params,
        ...(dataDir ? { dataDir } : {})
      }));
      dispatched = true;
      promise.catch((error) => originalError(`[Keyword Recollect] ${runId}: ${error.message}`));
      return { httpStatus: 200, body: { ok: true, data: response } };
    } catch (error) {
      return { httpStatus: 400, body: { ok: false, error: error.message } };
    } finally {
      if (createdReceipt && !dispatched) fs.unlinkSync(receipt);
      if (!reservation.promise) workbench.release(reservation);
    }
  }

  /**
   * 关键词确认阶段发起补充查询。
   * @param {object} options 参数。
   * @param {string} options.runId 运行 ID。
   * @param {string[]|string} [options.keywords] 补充关键词。
   * @param {object} [options.decisions] 人工决策。
   * @returns {{httpStatus:number, body:object}}
   */
  function queryKeywordSupplement({ runId, keywords: rawKeywords, decisions }) {
    if (!isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    const runtime = readRuntimeState({ runId });
    if (!runtime || !['daily', 'keyword', 'root-keyword'].includes(runtime.mode)
      || runtime.activeStep !== 'keywordReview' || !['blocked', 'paused', 'needs_review'].includes(runtime.status)) {
      return { httpStatus: 409, body: { ok: false, error: '请在关键词确认节点暂停时补充查询。' } };
    }
    const runState = workbench.tryAcquire({ runId, mode: 'keyword-supplement' });
    if (!runState) {
      return { httpStatus: 409, body: { ok: false, error: '已有工作流正在运行。' } };
    }
    try {
      const keywords = prepareSupplement({ runId, keywords: rawKeywords, decisions });
      const params = { ...runtime.params, reviewQueryKeywords: keywords };
      const promise = workbench.runReserved(runState, () => getPipelineRuntimeRunner()({
        runId,
        mode: runtime.mode,
        params,
        preserveRuntime: true,
        resumeFromStep: 'keywordReview',
        steps: runtime.steps
      }));
      promise.catch((error) => originalError(`[Keyword Supplement] ${runId}: ${error.message}`));
      return {
        httpStatus: 200,
        body: { ok: true, data: { runId, count: keywords.length, status: 'started' } }
      };
    } catch (error) {
      return { httpStatus: 400, body: { ok: false, error: error.message } };
    } finally {
      if (!runState.promise) workbench.release(runState);
    }
  }

  /**
   * 获取当前最新运行及历史列表。
   * @param {object} options 查询参数。
   * @returns {{httpStatus:number, body:object}}
   */
  function getCurrentPipelineRuns({ limit: rawLimit } = {}) {
    try {
      const limit = parsePositiveNumber(rawLimit, 20);
      const data = listPipelineRuns({ limit });
      return {
        httpStatus: 200,
        body: {
          ok: true,
          data: {
            ...data,
            currentRun: withPipelineRuntimeFields(data.latest)
          }
        }
      };
    } catch (err) {
      return { httpStatus: 500, body: { ok: false, error: err.message } };
    }
  }

  /**
   * 获取指定运行摘要。
   * @param {object} options 查询参数。
   * @param {string} options.runId 运行 ID。
   * @returns {{httpStatus:number, body:object}}
   */
  function getPipelineRunSummary({ runId }) {
    if (!isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    try {
      const summary = summarizePipelineRun({ runId });
      if (!summary) {
        return { httpStatus: 404, body: { ok: false, error: '未找到该流程运行记录' } };
      }
      return {
        httpStatus: 200,
        body: { ok: true, data: withPipelineRuntimeFields(summary) }
      };
    } catch (err) {
      return { httpStatus: 500, body: { ok: false, error: err.message } };
    }
  }

  /**
   * 追加候选关键词。
   * @param {object} options 参数。
   * @param {string} options.runId 运行 ID。
   * @param {object} [options.body] 请求体。
   * @returns {Promise<{httpStatus:number, body:object}>}
   */
  async function appendCandidates({ runId, body = {} }) {
    if (!isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    try {
      const result = await appendRunCandidates({
        ...(body || {}),
        runId,
        candidates: Array.isArray(body?.candidates) ? body.candidates : []
      });
      return {
        httpStatus: 200,
        body: {
          ok: true,
          data: {
            result,
            currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
          }
        }
      };
    } catch (err) {
      return { httpStatus: 500, body: { ok: false, error: err.message } };
    }
  }

  /**
   * 执行单个遗留流水线步骤。
   * @param {object} options 参数。
   * @param {string} options.runId 运行 ID。
   * @param {string} options.step 步骤名。
   * @param {object} [options.body] 请求体。
   * @returns {Promise<{httpStatus:number, body:object}>}
   */
  async function executeSingleStep({ runId, step: rawStep, body = {} }) {
    const step = String(rawStep || '');
    if (!isValidWorkflowRunIdParam(runId)) {
      return { httpStatus: 400, body: { ok: false, error: '无效的运行 ID。' } };
    }
    if (!PIPELINE_STEP_ALLOWLIST.has(step)) {
      return { httpStatus: 400, body: { ok: false, error: '不支持的流程步骤。' } };
    }
    if (workbench.current) {
      return {
        httpStatus: 409,
        body: { ok: false, error: '已有工作流正在运行，请等待完成后再继续。' }
      };
    }
    try {
      const result = await workbench.run({ runId, mode: 'pipeline-step' }, () => runPipelineStep(step, runId, body || {}));
      return {
        httpStatus: 200,
        body: {
          ok: true,
          data: {
            result,
            currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
          }
        }
      };
    } catch (err) {
      return { httpStatus: 500, body: { ok: false, error: err.message } };
    }
  }

  return {
    startRun,
    pauseRun,
    resumeRun,
    retryStep,
    cancelRun,
    validateWorkflowDefinition,
    updateInspirationRoots,
    recollectKeywordFilter,
    queryKeywordSupplement,
    getCurrentPipelineRuns,
    getPipelineRunSummary,
    appendCandidates,
    executeSingleStep
  };
}

module.exports = {
  createWorkflowControlService,
  isWorkflowRetryNodeAllowed,
  PIPELINE_STEP_ALLOWLIST,
  WORKFLOW_RETRY_NODE_ALLOWLIST,
  PEER_DISCOVERY_RETRY_NODE_ALLOWLIST
};
