'use strict';

const readJsonlPreview = require('../pipeline-run-summary').readJsonlPreview;
const getLLMProviderInfo = require('../llm').getLLMProviderInfo;
const { WORKFLOW_NODE_IDS } = require('./pipeline-definition-common');

function firstSycmFailure(summary) {
  const file = summary.files?.sycmResults;
  const rows = readJsonlPreview(file, 20);
  return rows.find(row => row && row.ok === false && (row.manualAction || row.error || row.status)) || null;
}

function firstOrderSheetProductFailure(summary) {
  const file = summary.files?.productRank;
  const rows = readJsonlPreview(file, 100);
  return rows.find(row => row && row.enrichmentStatus === 'failed' && row.enrichmentError) || null;
}

function sycmFailureIntervention(row) {
  if (!row) return null;
  const status = String(row.status || row.manualAction?.status || 'transient_failure');
  const error = String(row.error || row.manualAction?.error || '');
  const userMessage = String(row.manualAction?.userMessage || '').trim();
  const cdpUnavailable = /ECONNREFUSED|127\.0\.0\.1:9222|no chrome tab found|chrome[^\n]*(?:tab|debug)|cdp|devtools/i.test(error);

  if (cdpUnavailable) {
    return {
      blocker: 'sycm_transient_failure',
      actionHint: `Chrome CDP 不可用，生意参谋校验无法连接 9222 调试端口。原始错误：${error}`,
      platform: 'sycm',
      platformStatus: status,
      manualAction: {
        platform: 'sycm',
        status,
        userMessage: userMessage || '请启动带远程调试端口的 Chrome，登录生意参谋后重试。'
      },
      nextRecommendedAction: {
        action: 'start-sycm-chrome',
        label: '启动 Chrome',
        description: '启动带远程调试端口的 Chrome，登录生意参谋后重试校验。'
      }
    };
  }

  return {
    blocker: `sycm_${status}`,
    actionHint: userMessage || error || '生意参谋校验失败，请处理平台访问问题后重试。',
    platform: 'sycm',
    platformStatus: status,
    manualAction: row.manualAction || { platform: 'sycm', status, userMessage },
    nextRecommendedAction: {
      action: 'resume-after-manual',
      label: '我已处理，继续流程',
      description: '处理生意参谋访问问题后，从当前节点继续。'
    }
  };
}

/**
 * @param {object} summary 业务运行摘要。
 * @param {string} nodeId 当前节点 ID。
 * @returns {object|null} 阻塞原因和用户可执行的恢复动作。
 */
function summaryInterventionForNode(summary, nodeId) {
  const status = summary.status || 'unknown';
  const mode = summary.runtime?.mode || summary.options?.mode || '';
  if (mode === 'competitor-analysis') {
    if (status !== 'manual_action_required') return null;
    const activeNode = summary.runtime?.activeStep || WORKFLOW_NODE_IDS.resolveShops;
    if (nodeId !== activeNode) return null;
    const manualAction = summary.manualAction || summary.runtime?.manualAction || null;
    const platformErrorText = (manualAction?.errors || [])
      .map(item => `${item?.code || ''} ${item?.message || ''}`)
      .join('\n');
    const platformStatus = /内测期间仅开放部分用户|ACCESS_RESTRICTED/i.test(platformErrorText)
      ? 'TAOBAO_NATIVE_ACCESS_RESTRICTED'
      : /执行层未就绪|NOT_READY/i.test(platformErrorText)
        ? 'TAOBAO_NATIVE_NOT_READY'
        : String(manualAction?.status || 'manual_action_required');
    const accessRestricted = platformStatus === 'TAOBAO_NATIVE_ACCESS_RESTRICTED';
    const toolNotReady = platformStatus === 'TAOBAO_NATIVE_NOT_READY';
    const requiresPlatformAction = /LOGIN|SECURITY|TIMEOUT|UNAVAILABLE|ACCESS_RESTRICTED|NOT_READY|TOOL_ERROR|NATIVE_FAILED/i.test(platformStatus);
    const platformActionHint = accessRestricted
      ? '淘宝桌面版当前返回“内测期间仅开放部分用户”。请先完全退出并重新启动客户端；如果重启后仍持续出现，再检查客户端版本或账号开放状态。'
      : toolNotReady
        ? '淘宝桌面版自动化执行层未就绪。请完全退出并重新打开客户端，等待首页加载完成后重试。'
        : manualAction?.userMessage;
    return {
      blocker: summary.blockers?.[0] || 'taobao_native_manual_action_required',
      actionHint: platformActionHint || (requiresPlatformAction
        ? '请打开淘宝客户端并完成登录或安全验证后重试。'
        : '店铺榜单页面没有完整加载，请重新采集当前节点。'),
      platform: 'taobao-native',
      platformStatus,
      manualAction,
      nextRecommendedAction: {
        action: requiresPlatformAction ? 'start-taobao-native' : 'retry-node',
        label: accessRestricted ? '打开淘宝客户端' : requiresPlatformAction ? '打开淘宝客户端' : '重新采集失败榜单',
        description: accessRestricted
          ? '打开淘宝桌面版；若仍异常，请完全退出客户端后重新启动。'
          : requiresPlatformAction
            ? '打开淘宝首页，完成登录或验证后重试当前节点。'
          : '保留成功样本，只重新采集失败的店铺榜单。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.collectRank && status === 'manual_action_required') {
    const manualAction = summary.runtime?.manualAction || summary.manualAction || null;
    if (manualAction?.status === 'product_details_required' || summary.blockers?.includes('order_sheet_product_details_required')) {
      const detailFailure = firstOrderSheetProductFailure(summary);
      const detailError = String(detailFailure?.enrichmentError || '').trim();
      const chromeUnavailable = /ECONNREFUSED|127\.0\.0\.1:9222|no chrome tab found|chrome[^\n]*(?:tab|debug)|cdp|devtools/i.test(detailError);
      if (chromeUnavailable) {
        return {
          blocker: 'order_sheet_browser_cdp_unavailable',
          actionHint: `淘宝商品资料读取需要连接 Chrome 9222 调试端口。请启动 Chrome，确认淘宝已登录后重试获取商品资料。原始错误：${detailError}`,
          platform: 'taobao',
          platformStatus: 'browser_cdp_unavailable',
          manualAction,
          nextRecommendedAction: {
            action: 'start-sycm-chrome',
            label: '启动 Chrome',
            description: '启动带调试端口的 Chrome，并打开第一个待读取的淘宝商品。'
          }
        };
      }
      return {
        blocker: 'order_sheet_product_details_required',
        actionHint: manualAction?.userMessage || '部分指定商品没有读取到标题，请补充商品资料后继续生成表格。',
        platform: 'taobao',
        platformStatus: 'product_details_required',
        manualAction,
        nextRecommendedAction: {
          action: 'complete-order-sheet-products',
          label: '补充商品资料',
          description: '补充缺失的商品标题或下单金额，然后继续生成表格。'
        }
      };
    }
    const chromeUnavailable = String(manualAction?.status || '').includes('chrome');
    return {
      blocker: manualAction?.status || 'sycm_manual_action_required',
      actionHint: manualAction?.userMessage || '请在 Chrome 中登录生意参谋并处理安全验证后重试。',
      platform: 'sycm',
      platformStatus: manualAction?.status || 'manual_action_required',
      manualAction,
      nextRecommendedAction: chromeUnavailable
        ? { action: 'start-sycm-chrome', label: '启动 Chrome', description: '打开商品排行页面并完成登录。' }
        : { action: 'retry-node', label: '重试采集', description: '完成人工处理后重新采集商品排行。' }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.confirmProducts && ['needs_review', 'awaiting_product_confirmation', 'awaiting_user_confirmation'].includes(status)) {
    return {
      blocker: 'product_confirmation_required',
      actionHint: '请在页面核对商品资料、编辑下单金额并确认 1 拖 N 编组。',
      nextRecommendedAction: {
        action: 'confirm-order-sheet-products',
        label: '确认商品与编组',
        description: '核对商品资料与编组后，继续生成刷单表格。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.mine && ['mining_manual_action_required', 'mining_empty'].includes(status)) {
    const chromeUnavailable = summary.discovery?.blocker === 'sycm_chrome_unavailable';
    const blockerReason = summary.discovery?.blockerReason || '';
    const manualAction = summary.discovery?.manualAction || null;
    const platformBlocked = status === 'mining_manual_action_required';
    return {
      blocker: summary.discovery?.blocker || 'no_inspiration_candidates',
      actionHint: chromeUnavailable
        ? `动态词根无法连接生意参谋。${blockerReason}`
        : blockerReason || '今日灵感没有形成可用候选词，请查看词根拦截原因后重试。',
      platform: platformBlocked ? 'sycm' : null,
      platformStatus: chromeUnavailable ? 'chrome_unavailable' : manualAction?.status || null,
      manualAction: platformBlocked
        ? manualAction || {
            platform: 'sycm',
            status: chromeUnavailable ? 'chrome_unavailable' : 'manual_action_required',
            userMessage: chromeUnavailable
              ? '请启动 Chrome 并登录生意参谋，然后重试当前节点。'
              : '请在 Chrome 中处理生意参谋登录、滑块或权限问题后重试。'
          }
        : null,
      nextRecommendedAction: chromeUnavailable || platformBlocked
        ? {
            action: 'start-sycm-chrome',
            label: '启动 Chrome',
            description: '启动带远程调试端口的 Chrome，完成生意参谋登录或验证后重试当前拓词节点。'
          }
        : {
            action: 'retry-node',
            label: '重新发现灵感',
            description: '使用新的抽样序列重新收集灵感并生成商品词根。'
          }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.keywordReview) {
    if (status === 'awaiting_keyword_review') {
      return {
        blocker: 'keyword_review_required',
        actionHint: '请先人工筛选候选词。确认后的关键词才会进入生意参谋校验，避免浪费平台请求。',
        nextRecommendedAction: {
          action: 'confirm-keyword-review',
          label: '确认筛词结果',
          description: '将当前保留的候选词写入人工筛词产物，然后继续生意参谋校验。'
        }
      };
    }
    if (status === 'keyword_review_empty') {
      return {
        blocker: 'no_keyword_review_approved',
        actionHint: '人工筛词后没有保留关键词。请返回选词挖掘补充候选词，或重新筛选。',
        nextRecommendedAction: {
          action: 'mine-more',
          label: '补充候选词',
          description: '回到选词挖掘节点补充候选词。'
        }
      };
    }
  }
  if (nodeId === WORKFLOW_NODE_IDS.verify) {
    const sycmFailure = sycmFailureIntervention(firstSycmFailure(summary));
    if (sycmFailure && ['verified_empty', 'manual_action_required', 'verified_partial_manual_required'].includes(status)) {
      return sycmFailure;
    }
    if (status === 'verified_empty') {
      return {
        blocker: 'verified_empty',
        actionHint: '生意参谋验真没有通过词。请更换候选词、降低蓝海阈值，或重新挖词后再继续。',
        nextRecommendedAction: {
          action: 'mine-more',
          label: '补充候选词',
          description: '当前没有通过生意参谋验真的词，先补充候选词再重跑验真。'
        }
      };
    }
    if (status === 'verified_no_generation_eligible') {
      return {
        blocker: 'no_generation_eligible_keywords',
        actionHint: '生意参谋有验真词，但关键词机会分都未通过。请补充候选词、调整筛选参数，或人工放行后再生成标题。',
        nextRecommendedAction: {
          action: 'mine-more',
          label: '补充候选词',
          description: '先补充更符合蓝海机会的候选词，再重跑生意参谋校验。'
        }
      };
    }
    if (status === 'manual_action_required') {
      return {
        blocker: 'sycm_manual_action_required',
        actionHint: '生意参谋需要人工处理。请确认登录、滑块、权限或功能入口后继续流程。',
        nextRecommendedAction: {
          action: 'resume-after-manual',
          label: '我已处理，继续流程',
          description: '处理登录、滑块、权限或功能入口后，从当前节点继续。'
        }
      };
    }
    if (status === 'verified_partial_manual_required') {
      return {
        blocker: 'sycm_partial_manual_required',
        actionHint: '部分关键词已验真，但生意参谋仍需要人工处理。可先继续使用已通过词，或处理登录、滑块、权限后继续验真。',
        nextRecommendedAction: {
          action: 'continue-or-fix-sycm',
          label: '继续使用已通过词',
          description: '已有部分关键词通过，可继续生成；也可以先处理生意参谋后重试验真。'
        }
      };
    }
  }
  if (nodeId === WORKFLOW_NODE_IDS.generate && status === 'generate_failed') {
    const failure = (summary.previews?.generatedProducts || [])
      .find(row => row && row.status === 'generate_failed');
    const llmInfo = getLLMProviderInfo({ provider: failure?.llmProvider });
    const llmModel = failure?.llmModel || llmInfo.model;
    const providerLabel = llmModel
      ? `${llmInfo.label}（${llmModel}）`
      : llmInfo.label;
    const reason = String(failure?.error || '').trim();
    const isTimeout = failure?.code === 'title_generation_timeout' || /标题生成超时/.test(reason);
    const timeoutAdvice = llmInfo.provider === 'minimax'
      ? '模型配置已识别，请重跑标题生成；系统将使用更长的 MiniMax 生成时限。'
      : '模型配置已识别，请减少单次商品数量或调高标题生成时限后重跑。';
    return {
      blocker: 'generate_failed',
      actionHint: reason
        ? `标题生成失败。当前使用 ${providerLabel}。失败原因：${reason}${isTimeout ? `。${timeoutAdvice}` : ''}`
        : `标题生成失败。当前使用 ${providerLabel}。请检查当前模型服务配置、关键词数据和运行日志后重试。`,
      llmProvider: llmInfo.provider,
      llmModel,
      nextRecommendedAction: {
        action: 'retry-node',
        label: '重跑标题生成',
        description: isTimeout
          ? '使用更长的标题生成时限重新运行当前节点。'
          : '保留当前产物并重新运行标题生成节点。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.select && status === 'select_failed') {
    const manualMode = summary.runtime?.mode === 'manual' || summary.options?.mode === 'manual';
    const evaluatedCount = Number(summary.counts?.productsEvaluated || summary.funnel?.select?.input || 0);
    const rejectedCount = Number(summary.counts?.productRejected || summary.funnel?.select?.rejected || 0);
    const detailFailure = manualMode
      ? (summary.previews?.selectedProducts || []).find(row => row?.status === 'enrich_failed')
      : null;
    if (manualMode && detailFailure) {
      const reason = String(detailFailure.enrichError || '').trim();
      return {
        blocker: 'product_detail_fetch_failed',
        actionHint: reason
          ? `1688 商品资料获取失败：${reason}。当前尚未进入生意参谋验真。`
          : '1688 商品资料获取失败，当前尚未进入生意参谋验真。',
        platform: '1688',
        platformStatus: detailFailure.enrichErrorCode || 'detail_fetch_failed',
        nextRecommendedAction: {
          action: 'retry-node',
          label: '重试获取商品资料',
          description: '重新读取 1688 商品标题、类目和价格，再继续提取候选词。'
        }
      };
    }
    if (evaluatedCount > 0) {
      return {
        blocker: 'no_selected_products',
        actionHint: `已获取 ${evaluatedCount} 个 1688 货源，但没有商品通过机会评分${rejectedCount > 0 ? `，其中 ${rejectedCount} 个被评分门槛拦截` : ''}。可人工勾选合适货源，或调整筛选条件后重新搜索。`,
        platform: '1688',
        platformStatus: 'product_opportunity_rejected',
        nextRecommendedAction: {
          action: 'product-review',
          label: '勾选 1688 货源',
          description: '查看已获取的候选货源，人工勾选合适商品后继续生成标题。'
        }
      };
    }
    return {
      blocker: 'no_selected_products',
      actionHint: '货源选品没有选出可用商品。请检查 1688 搜索配置、放宽选品数量，或回到生意参谋节点更换候选词。',
      nextRecommendedAction: {
        action: 'retry-node',
        label: '重跑货源选品',
        description: '重新搜索 1688 货源并计算商品机会分。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export && status === 'export_empty') {
    return {
      blocker: 'export_empty',
      actionHint: '没有可导出的铺货商品。请返回标题生成结果，补充可铺货商品后再导出。'
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export && status === 'needs_review') {
    return {
      blocker: 'review_rejected_rows',
      actionHint: '铺货前需要人工复核。请在铺货复核节点处理风险项后再继续提交。',
      nextRecommendedAction: {
        action: 'open-review',
        label: '处理铺货复核',
        description: '查看自动清单、拦截原因，并人工加入可铺货项。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export && (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation')) {
    return {
      nextRecommendedAction: {
        action: 'confirm-distribution',
        label: '确认铺货清单',
        description: '铺货前必须人工确认具体商品清单，确认后再进入提交动作。'
      }
    };
  }
  return null;
}

module.exports = { summaryInterventionForNode };
