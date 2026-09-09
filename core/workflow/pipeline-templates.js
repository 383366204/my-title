'use strict';

const { WORKFLOW_NODE_IDS, localIsoDate } = require('./pipeline-definition-common');

function workflowNodes(mode = 'daily') {
  const withSteps = (nodes) => nodes.map((node, index) => ({
    ...node,
    data: {
      ...node.data,
      stepIndex: index + 1,
      stepTotal: nodes.length
    }
  }));
  const positionNodes = (nodes, { startX = 60, stepX = 260, y = 120 } = {}) => (
    nodes.map((node, index) => ({
      ...node,
      position: { x: startX + index * stepX, y }
    }))
  );
  const startData = mode === 'root-keyword'
    ? {
        label: '录入词根',
        description: '批量输入词根并配置安全查询节奏',
        rootsText: '',
        roots: [],
        sycmMode: 'hot',
        period: '7d',
        compareType: 'cycle',
        sycmRiskProfile: 'standard',
        sycmMinIntervalMs: 45000,
        sycmMaxIntervalMs: 90000,
        sycmBatchSize: 10,
        sycmMinBatchCooldownMs: 300000,
        sycmMaxBatchCooldownMs: 600000,
        sycmMaxRetries: 2,
        length: 60,
        productsPerKeyword: 12,
        port: 9222
      }
    : mode === 'keyword'
    ? {
        label: '开始',
        description: '批量输入精确关键词并启动',
        keyword: '',
        keywordsText: '',
        export: 20,
        productsPerKeyword: 12,
        length: 60,
        pages: 1
      }
    : {
        label: '开始',
        description: '从新闻、字典和趋势动态发现商品词根',
        mine: 50,
        discoveryMode: 'inspiration',
        source: 'inspiration',
        rootMode: 'auto',
        rootLimit: 8,
        rootCooldownDays: 14,
        familyCooldownDays: 7,
        inspirationSycmPages: 1,
        inspirationUseLLM: true,
        verify: 20,
        generate: 10,
        select: 10,
        export: 20,
        productsPerKeyword: 12,
        length: 60,
        pages: 1
      };
  if (mode === 'competitor-analysis') {
    return withSteps(positionNodes([
      {
        id: WORKFLOW_NODE_IDS.start,
        type: 'production-start',
        data: {
          label: '录入同行',
          description: '粘贴多个淘宝分享文案、商品或店铺链接',
          competitorConfig: true,
          competitorText: '',
          maxShops: 5,
          hotLimit: 20,
          newLimit: 20,
          detailLimit: 20,
          waitMs: 1200,
          compareHistory: true
        }
      },
      { id: WORKFLOW_NODE_IDS.resolveShops, type: 'pipeline-resolve-shops', data: { label: '识别同行店铺', description: '解析分享短链、商品所属店铺并按店铺去重' } },
      { id: WORKFLOW_NODE_IDS.collectCompetitors, type: 'pipeline-collect-competitors', data: { label: '采集爆款与新品', description: '依次读取店铺销量排序和新品排序' } },
      { id: WORKFLOW_NODE_IDS.enrichCompetitors, type: 'pipeline-enrich-competitors', data: { label: '补全商品链接', description: '逐个打开榜单商品，补充可点击链接和商品ID' } },
      { id: WORKFLOW_NODE_IDS.analyzeCompetitors, type: 'pipeline-analyze-competitors', data: { label: '同行对比分析', description: '分析商品结构、高频词和新品起量信号' } },
      { id: WORKFLOW_NODE_IDS.competitorReport, type: 'pipeline-competitor-report', data: { label: '生成分析报告', description: '生成可查看、可下载的同行分析报告' } },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '查看报告或将机会词加入选品流水线', competitorDownload: true } }
    ], { startX: 90, stepX: 275 }));
  }
  if (mode === 'order-sheet') {
    return withSteps(positionNodes([
      { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '开始', description: '选择商品排行或输入指定商品', orderSheetConfig: true, inputMode: 'rank', manualItemsText: '', manualItems: [], port: 9222, dateMode: 'latest_day', startDate: '', endDate: '', pages: 1, sortMetric: 'itmUv' } },
      { id: WORKFLOW_NODE_IDS.collectRank, type: 'pipeline-collect-rank', data: { label: '获取商品资料', description: '采集排行或补全指定商品的标题、主图和店铺' } },
      { id: WORKFLOW_NODE_IDS.confirmProducts, type: 'pipeline-confirm-products', data: { label: '确认商品与编组', description: '选择购买规格、核对金额并配置 1 拖 N 编组' } },
      {
        id: WORKFLOW_NODE_IDS.generateSheet,
        type: 'pipeline-generate-sheet',
        data: {
          label: '生成业务表格',
          description: '配置格式和内容后生成可下载的 Excel',
          sheetConfig: true,
          sheetType: 'order',
          orderSheetOnly: true,
          storeName: '',
          orderDate: localIsoDate(),
          productLimit: 0,
          fileName: '',
          includeRawData: true,
          includeImages: true,
          amountMode: 'average',
          missingAmountPolicy: 'blank',
          cartQuantity: 1,
          rowSpan: 3,
          workRequirement: '点一两款其他店同行的产品看一下，然后再下单',
          orderNote: '',
          reviewGroupSize: 4,
          includeSpacerRow: true
        }
      },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '下载 Excel 并核对待补充信息' } }
    ], { startX: 120, stepX: 280 }));
  }
  if (mode === 'review-sheet') {
    return withSteps(positionNodes([
      { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '上传刷单表', description: '上传已执行的刷单表并确认订单分组', reviewUpload: true, uploadId: '', uploadName: '', groups: [] } },
      { id: WORKFLOW_NODE_IDS.importSheet, type: 'pipeline-import-sheet', data: { label: '解析订单分组', description: '识别工作表、商品和订单信息缺失项' } },
      { id: WORKFLOW_NODE_IDS.generateReviews, type: 'pipeline-generate-reviews', data: { label: '真实体验整理', description: '根据真实体验整理文案，查重后逐条确认', reviewConfig: true, reviewTone: '自然真实', reviewLength: 35, useAI: true } },
      { id: WORKFLOW_NODE_IDS.generateSheet, type: 'pipeline-generate-sheet', data: { label: '生成评价表', description: '按确认后的订单组生成评价 Excel', sheetConfig: true, sheetType: 'review', reviewSourceUpload: true, fileName: '', includeSpacerRow: true } },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '下载评价表并核对内容' } }
    ], { startX: 120, stepX: 280 }));
  }
  if (mode === 'manual') {
    return withSteps(positionNodes([
      { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '录入1688链接', description: '粘贴商品链接或手机分享口令，关键词可选', manualInput: true, defaultKeyword: '', items: [], length: 60, export: 20 } },
      { id: WORKFLOW_NODE_IDS.select, type: 'pipeline-select', data: { label: '获取商品与候选词', description: '读取标题、主图、类目并提取短词根', manualDirectInput: true } },
      { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '生意参谋验真', description: '验证候选词并为每件商品选定最优词' } },
      { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: 'MiniMax生成标题', description: '基于选定词、原商品和类目生成标题' } },
      { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '铺货复核与执行', description: '确认标题和类目后自动铺货' } },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '铺货结果确认后完成流程' } }
    ], { startX: 150 }));
  }
  if (mode === 'keyword') {
    return withSteps(positionNodes([
      { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: startData },
      { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '生意参谋校验', description: '验证搜索人气和供需' } },
      { id: WORKFLOW_NODE_IDS.select, type: 'pipeline-select', data: { label: '货源选品', description: '搜索1688货源并评分筛选' } },
      { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: '标题生成', description: '基于已选货源生成铺货标题' } },
      { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '铺货复核', description: '确认清单、风险和人工加入项' } },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '查看结果和批次记录' } }
    ], { startX: 190 }));
  }
  if (mode === 'root-keyword') {
    return withSteps(positionNodes([
      { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: startData },
      { id: WORKFLOW_NODE_IDS.mine, type: 'pipeline-mine', data: { label: '生意参谋拓词', description: '按安全节奏逐个查询词根并持续保存结果', discoveryMode: 'user_roots' } },
      { id: WORKFLOW_NODE_IDS.keywordReview, type: 'pipeline-keyword-review', data: { label: '人工筛词', description: '按词根、市场数据和机会分筛选候选词' } },
      { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '关键词机会确认', description: '复用新鲜数据，只补查缺失或过期指标' } },
      { id: WORKFLOW_NODE_IDS.select, type: 'pipeline-select', data: { label: '货源选品', description: '为确认后的关键词搜索并勾选1688货源' } },
      { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: '标题生成', description: '基于关键词和已选货源生成铺货标题' } },
      { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '铺货复核', description: '确认标题、类目和待铺货商品' } },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '查看结果和批次记录' } }
    ], { startX: 60, stepX: 260 }));
  }
  return withSteps(positionNodes([
    { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: startData },
    { id: WORKFLOW_NODE_IDS.mine, type: 'pipeline-mine', data: { label: '灵感选词', description: '收集灵感、生成商品词根并查询关联词', discoveryMode: 'inspiration' } },
    { id: WORKFLOW_NODE_IDS.keywordReview, type: 'pipeline-keyword-review', data: { label: '人工筛词', description: '人工筛除不适合验真的候选词' } },
    { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '生意参谋校验', description: '验证搜索人气和供需' } },
    { id: WORKFLOW_NODE_IDS.select, type: 'pipeline-select', data: { label: '货源选品', description: '搜索1688货源并评分筛选' } },
    { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: '标题生成', description: '基于已选货源生成铺货标题' } },
    { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '铺货复核', description: '确认清单、风险和人工加入项' } },
    { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '查看结果和批次记录' } }
  ]));
}

function workflowEdges(mode = 'daily') {
  const pairs = mode === 'competitor-analysis'
    ? [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.resolveShops],
        [WORKFLOW_NODE_IDS.resolveShops, WORKFLOW_NODE_IDS.collectCompetitors],
        [WORKFLOW_NODE_IDS.collectCompetitors, WORKFLOW_NODE_IDS.enrichCompetitors],
        [WORKFLOW_NODE_IDS.enrichCompetitors, WORKFLOW_NODE_IDS.analyzeCompetitors],
        [WORKFLOW_NODE_IDS.analyzeCompetitors, WORKFLOW_NODE_IDS.competitorReport],
        [WORKFLOW_NODE_IDS.competitorReport, WORKFLOW_NODE_IDS.end]
      ]
    : mode === 'order-sheet'
    ? [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.collectRank],
        [WORKFLOW_NODE_IDS.collectRank, WORKFLOW_NODE_IDS.confirmProducts],
        [WORKFLOW_NODE_IDS.confirmProducts, WORKFLOW_NODE_IDS.generateSheet],
        [WORKFLOW_NODE_IDS.generateSheet, WORKFLOW_NODE_IDS.end]
      ]
    : mode === 'review-sheet'
      ? [
          [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.importSheet],
          [WORKFLOW_NODE_IDS.importSheet, WORKFLOW_NODE_IDS.generateReviews],
          [WORKFLOW_NODE_IDS.generateReviews, WORKFLOW_NODE_IDS.generateSheet],
          [WORKFLOW_NODE_IDS.generateSheet, WORKFLOW_NODE_IDS.end]
        ]
    : mode === 'keyword'
    ? [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.verify],
        [WORKFLOW_NODE_IDS.verify, WORKFLOW_NODE_IDS.select],
        [WORKFLOW_NODE_IDS.select, WORKFLOW_NODE_IDS.generate],
        [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
        [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
      ]
    : mode === 'manual'
      ? [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.select],
        [WORKFLOW_NODE_IDS.select, WORKFLOW_NODE_IDS.verify],
        [WORKFLOW_NODE_IDS.verify, WORKFLOW_NODE_IDS.generate],
        [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
        [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
      ]
      : [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.mine],
        [WORKFLOW_NODE_IDS.mine, WORKFLOW_NODE_IDS.keywordReview],
        [WORKFLOW_NODE_IDS.keywordReview, WORKFLOW_NODE_IDS.verify],
        [WORKFLOW_NODE_IDS.verify, WORKFLOW_NODE_IDS.select],
        [WORKFLOW_NODE_IDS.select, WORKFLOW_NODE_IDS.generate],
        [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
        [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
      ];
  return pairs.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    type: 'straight'
  }));
}

function template(id, name, mode, description, meta = {}) {
  return {
    id,
    name,
    mode,
    description,
    entryLabel: meta.entryLabel || '',
    scenarioLabel: meta.scenarioLabel || '',
    flowSummary: meta.flowSummary || '',
    modeHint: meta.modeHint || '',
    production: true,
    workflow: {
      nodes: workflowNodes(mode),
      edges: workflowEdges(mode)
    }
  };
}

/**
 * 列出真实 pipeline 对应的固定工作流模板。
 * @returns {Array<object>} 模板列表。
 */
function listProductionWorkflowTemplates() {
  return [
    template('daily-selection-v1', '每日蓝海选品流水线', 'daily', '选词、验真、生成标题并导出铺货清单', {
      entryLabel: '入口：动态灵感',
      scenarioLabel: '适合：每天自动发现新机会',
      flowSummary: '流程：灵感选词 → 人工筛词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
      modeHint: '从新闻、字典、日历和趋势动态发现词根，不要求预先维护种子池。'
    }),
    template('exact-keyword-v1', '精确关键词选品流水线', 'keyword', '按用户给定关键词生成铺货清单', {
      entryLabel: '入口：手动关键词',
      scenarioLabel: '适合：批量验证明确目标词',
      flowSummary: '流程：批量输入关键词 → 跳过挖词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
      modeHint: '每行输入一个关键词，系统会逐词验真、选品和生成标题。'
    }),
    template('root-keyword-selection-v1', '词根拓词选品流水线', 'root-keyword', '输入词根，通过生意参谋拓词后进入选品和铺货', {
      entryLabel: '入口：手动词根',
      scenarioLabel: '适合：从短词根持续拓展选品机会',
      flowSummary: '流程：录入词根 → 分时拓词 → 人工筛词 → 机会确认 → 货源选品 → 标题生成 → 铺货复核',
      modeHint: '词根和候选词不设业务数量上限；系统按安全间隔串行查询，并可暂停后继续。'
    }),
    template('manual-selection-v2', '1688链接智能铺货流水线', 'manual', '输入1688链接，自动查词、生成标题并准备铺货', {
      entryLabel: '入口：1688链接（关键词可选）',
      scenarioLabel: '适合：已经确定货源',
      flowSummary: '流程：录入链接 → 获取商品与候选词 → 生意参谋验真 → MiniMax生成标题 → 铺货复核',
      modeHint: '支持1688商品链接和手机分享口令；填写关键词时会优先验证人工词。'
    }),
    template('sycm-order-sheet-v1', '制作刷单表格流水线', 'order-sheet', '从商品排行或指定商品生成 Excel', {
      entryLabel: '入口：商品排行或指定商品',
      scenarioLabel: '适合：制作动销刷单表',
      flowSummary: '流程：选择商品来源 → 获取商品资料 → 确认商品与编组 → 生成 Excel',
      modeHint: '可以读取生意参谋商品排行，也可以直接输入淘宝或天猫商品 ID、链接。'
    }),
    template('uploaded-review-sheet-v1', '根据刷单表生成评价表', 'review-sheet', '上传已执行的刷单表，补全订单信息并生成评价表', {
      entryLabel: '入口：已执行的刷单表',
      scenarioLabel: '适合：刷单完成后整理评价任务',
      flowSummary: '流程：上传刷单表 → 解析订单组 → 生成并复核评价 → 导出评价表',
      modeHint: '上传实际使用过的 .xlsx 刷单表；订单号、手机号和旺旺只保存在本机。'
    }),
    template('competitor-analysis-v1', '同行分析流水线', 'competitor-analysis', '进入同行店铺分析销量榜、新品榜和机会方向', {
      entryLabel: '入口：同行分享链接',
      scenarioLabel: '适合：跟踪同行爆款和上新方向',
      flowSummary: '流程：录入同行 → 识别店铺 → 采集爆款与新品 → 补全商品链接 → 对比分析 → 导出报告',
      modeHint: '支持完整淘宝分享文案、短链接、商品链接和店铺链接；采集期间会使用当前淘宝客户端登录状态。'
    })
  ];
}

function legacyManualWorkflowTemplate() {
  const nodes = [
    { id: WORKFLOW_NODE_IDS.start, type: 'production-start', position: { x: 110, y: 120 }, data: { label: '开始', description: '输入关键词后人工筛选' } },
    { id: WORKFLOW_NODE_IDS.keywordReview, type: 'pipeline-keyword-review', position: { x: 370, y: 120 }, data: { label: '人工选词与选品', description: '筛选关键词并选择 1688 货源' } },
    { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', position: { x: 630, y: 120 }, data: { label: 'AI生成标题', description: '根据关键词和商品信息生成标题' } },
    { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', position: { x: 890, y: 120 }, data: { label: '输出铺货清单', description: '输出 URL$$标题$$类目 格式' } },
    { id: WORKFLOW_NODE_IDS.end, type: 'production-end', position: { x: 1150, y: 120 }, data: { label: '完成', description: '查看标准铺货清单' } }
  ].map((node, index, items) => ({
    ...node,
    data: { ...node.data, stepIndex: index + 1, stepTotal: items.length }
  }));
  const pairs = [
    [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.keywordReview],
    [WORKFLOW_NODE_IDS.keywordReview, WORKFLOW_NODE_IDS.generate],
    [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
    [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
  ];
  return {
    id: 'manual-selection-v1',
    mode: 'manual',
    nodes,
    edges: pairs.map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'straight' }))
  };
}

function directInputManualWorkflowTemplate() {
  const nodes = positionNodes([
    { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '录入词和货源', description: '输入关键词和 1688 商品链接', manualInput: true } },
    { id: WORKFLOW_NODE_IDS.select, type: 'pipeline-select', data: { label: '获取商品资料', description: '读取商品标题、主图、类目和价格', manualDirectInput: true } },
    { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: 'AI生成标题', description: '根据关键词和商品信息生成标题' } },
    { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '铺货复核与执行', description: '确认标题和类目后自动铺货' } },
    { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '铺货结果确认后完成流程' } }
  ], { startX: 150 });
  const pairs = [
    [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.select],
    [WORKFLOW_NODE_IDS.select, WORKFLOW_NODE_IDS.generate],
    [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
    [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
  ];
  return {
    id: 'manual-selection-v1',
    mode: 'manual',
    nodes: withSteps(nodes),
    edges: pairs.map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'straight' }))
  };
}

/**
 * @param {object} summary 含模式与历史版本信息的运行摘要。
 * @returns {object} 与历史运行兼容的模板定义。
 */
function templateForSummary(summary) {
  const options = summary.options || {};
  const mode = summary.runtime?.mode || summary.options?.mode || (options.keyword || summary.exactKeyword ? 'keyword' : 'daily');
  const manualVersion = Number(options.workflowVersion || 1);
  if (mode === 'manual' && manualVersion < 2) {
    return { id: 'manual-selection-v1', mode: 'manual', workflow: legacyManualWorkflowTemplate() };
  }
  if (mode === 'manual' && manualVersion === 2) {
    return { id: 'manual-selection-v1', mode: 'manual', workflow: directInputManualWorkflowTemplate() };
  }
  const id = mode === 'keyword'
    ? 'exact-keyword-v1'
    : mode === 'root-keyword'
      ? 'root-keyword-selection-v1'
    : mode === 'manual'
      ? 'manual-selection-v2'
      : mode === 'order-sheet'
        ? 'sycm-order-sheet-v1'
      : mode === 'review-sheet'
          ? 'uploaded-review-sheet-v1'
          : mode === 'competitor-analysis'
            ? 'competitor-analysis-v1'
        : 'daily-selection-v1';
  return listProductionWorkflowTemplates().find(item => item.id === id);
}

module.exports = { listProductionWorkflowTemplates, templateForSummary };
