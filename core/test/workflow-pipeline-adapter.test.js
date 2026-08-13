'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  WORKFLOW_NODE_IDS,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  validateProductionWorkflow,
  resolveProductionWorkflowLaunch,
  resolveProductionWorkflowDefinition,
  pipelineSummaryToWorkflowRun,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact,
  writeWorkflowDefinition,
  readWorkflowDefinition,
  appendWorkflowEvent,
  readWorkflowEvents,
  deleteWorkflowRun
} = require('../workflow/pipeline-adapter');

function tempPipelineDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-pipeline-adapter-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

describe('workflow pipeline adapter', () => {
  it('lists the fixed production workflow templates', () => {
    assert.deepEqual(WORKFLOW_NODE_IDS, {
      start: 'start',
      mine: 'mine',
      keywordReview: 'keywordReview',
      verify: 'verify',
      select: 'select',
      generate: 'generate',
      export: 'export',
      review: 'review',
      collectRank: 'collectRank',
      importSheet: 'importSheet',
      generateReviews: 'generateReviews',
      generateSheet: 'generateSheet',
      end: 'end'
    });

    const templates = listProductionWorkflowTemplates();

    assert.deepEqual(templates.map(template => template.id), ['daily-selection-v1', 'exact-keyword-v1', 'manual-selection-v1', 'sycm-order-sheet-v1', 'uploaded-review-sheet-v1']);
    assert.deepEqual(templates.map(template => template.entryLabel), ['入口：动态灵感', '入口：手动关键词', '入口：关键词 + 1688链接', '入口：生意参谋商品排行', '入口：已执行的刷单表']);
    assert.match(templates[0].scenarioLabel, /每天自动发现/);
    assert.match(templates[1].scenarioLabel, /明确目标词/);
    assert.match(templates[0].flowSummary, /灵感选词/);
    assert.match(templates[1].flowSummary, /跳过挖词/);
    assert.match(templates[0].modeHint, /不要求预先维护种子池/);
    assert.match(templates[1].modeHint, /逐词验真/);
    assert.match(templates[2].flowSummary, /录入词和货源/);
    assert.match(templates[2].flowSummary, /自动铺货/);
    assert.match(templates[3].flowSummary, /指标降序/);
    const orderSheetStart = templates[3].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start);
    const orderSheetGenerate = templates[3].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.generateSheet);
    assert.equal(orderSheetStart.data.orderSheetConfig, true);
    assert.equal(orderSheetStart.data.pages, 1);
    assert.equal(orderSheetStart.data.sortMetric, 'itmUv');
    assert.equal(orderSheetGenerate.data.sheetConfig, true);
    assert.equal(orderSheetGenerate.data.sheetType, 'order');
    assert.equal(orderSheetGenerate.data.orderSheetOnly, true);
    assert.equal(orderSheetGenerate.data.rowSpan, 3);
    const reviewSheetStart = templates[4].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start);
    const reviewSheetGenerate = templates[4].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.generateSheet);
    assert.equal(reviewSheetStart.data.reviewUpload, true);
    assert.equal(reviewSheetGenerate.data.reviewSourceUpload, true);
    assert.equal(reviewSheetGenerate.data.sheetType, 'review');
    const dailyStart = templates[0].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start);
    const keywordStart = templates[1].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start);
    assert.deepEqual(Object.keys(dailyStart.data).sort(), [
      'description',
      'discoveryMode',
      'export',
      'familyCooldownDays',
      'generate',
      'inspirationSycmPages',
      'inspirationUseLLM',
      'label',
      'length',
      'mine',
      'pages',
      'productsPerKeyword',
      'rootCooldownDays',
      'rootLimit',
      'rootMode',
      'select',
      'source',
      'stepIndex',
      'stepTotal',
      'verify'
    ]);
    assert.equal(keywordStart.data.keyword, '');
    assert.equal(keywordStart.data.keywordsText, '');
    assert.deepEqual(templates[2].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start).data.items, []);
    for (const template of templates) {
      assert.equal(template.production, true);
      assert.ok(template.workflow);
    }
    assert.deepEqual(templates[0].workflow.nodes.map(node => node.id), [
      WORKFLOW_NODE_IDS.start,
      WORKFLOW_NODE_IDS.mine,
      WORKFLOW_NODE_IDS.keywordReview,
      WORKFLOW_NODE_IDS.verify,
      WORKFLOW_NODE_IDS.select,
      WORKFLOW_NODE_IDS.generate,
      WORKFLOW_NODE_IDS.export,
      WORKFLOW_NODE_IDS.end
    ]);
    assert.deepEqual(templates[0].workflow.edges.map(edge => `${edge.source}->${edge.target}`), [
      'start->mine',
      'mine->keywordReview',
      'keywordReview->verify',
      'verify->select',
      'select->generate',
      'generate->export',
      'export->end'
    ]);
    assert.ok(templates[0].workflow.edges.every(edge => edge.type === 'straight'));
    assert.deepEqual(templates[1].workflow.nodes.map(node => node.id), [
      WORKFLOW_NODE_IDS.start,
      WORKFLOW_NODE_IDS.verify,
      WORKFLOW_NODE_IDS.select,
      WORKFLOW_NODE_IDS.generate,
      WORKFLOW_NODE_IDS.export,
      WORKFLOW_NODE_IDS.end
    ]);
    assert.deepEqual(templates[1].workflow.edges.map(edge => `${edge.source}->${edge.target}`), [
      'start->verify',
      'verify->select',
      'select->generate',
      'generate->export',
      'export->end'
    ]);
    assert.ok(templates[1].workflow.edges.every(edge => edge.type === 'straight'));
    assert.deepEqual(templates[2].workflow.nodes.map(node => node.id), [
      WORKFLOW_NODE_IDS.start,
      WORKFLOW_NODE_IDS.select,
      WORKFLOW_NODE_IDS.generate,
      WORKFLOW_NODE_IDS.export,
      WORKFLOW_NODE_IDS.end
    ]);
    assert.deepEqual(templates[2].workflow.edges.map(edge => `${edge.source}->${edge.target}`), [
      'start->select',
      'select->generate',
      'generate->export',
      'export->end'
    ]);
    assert.ok(templates[2].workflow.edges.every(edge => edge.type === 'straight'));
    assert.deepEqual(templates[3].workflow.nodes.map(node => node.id), [
      WORKFLOW_NODE_IDS.start,
      WORKFLOW_NODE_IDS.collectRank,
      WORKFLOW_NODE_IDS.generateSheet,
      WORKFLOW_NODE_IDS.end
    ]);
    assert.deepEqual(templates[3].workflow.edges.map(edge => `${edge.source}->${edge.target}`), [
      'start->collectRank',
      'collectRank->generateSheet',
      'generateSheet->end'
    ]);
  });

  it('keeps production workflow template nodes compact and ordered for canvas fit', () => {
    const templates = listProductionWorkflowTemplates();

    for (const template of templates) {
      const nodes = template.workflow.nodes;
      const xs = nodes.map(node => node.position.x);
      const ys = nodes.map(node => node.position.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const uniquePositions = new Set(nodes.map(node => `${node.position.x},${node.position.y}`));
      const nodeWidth = 232;
      const nodeHeight = 118;
      const minGap = 24;

      const expectedIds = template.mode === 'order-sheet'
        ? [
            WORKFLOW_NODE_IDS.start,
            WORKFLOW_NODE_IDS.collectRank,
            WORKFLOW_NODE_IDS.generateSheet,
            WORKFLOW_NODE_IDS.end
          ]
        : template.mode === 'review-sheet'
          ? [
              WORKFLOW_NODE_IDS.start,
              WORKFLOW_NODE_IDS.importSheet,
              WORKFLOW_NODE_IDS.generateReviews,
              WORKFLOW_NODE_IDS.generateSheet,
              WORKFLOW_NODE_IDS.end
            ]
        : template.mode === 'keyword'
        ? [
            WORKFLOW_NODE_IDS.start,
            WORKFLOW_NODE_IDS.verify,
            WORKFLOW_NODE_IDS.select,
            WORKFLOW_NODE_IDS.generate,
            WORKFLOW_NODE_IDS.export,
            WORKFLOW_NODE_IDS.end
          ]
        : template.mode === 'manual'
          ? [
              WORKFLOW_NODE_IDS.start,
              WORKFLOW_NODE_IDS.select,
              WORKFLOW_NODE_IDS.generate,
              WORKFLOW_NODE_IDS.export,
              WORKFLOW_NODE_IDS.end
            ]
        : [
            WORKFLOW_NODE_IDS.start,
            WORKFLOW_NODE_IDS.mine,
            WORKFLOW_NODE_IDS.keywordReview,
            WORKFLOW_NODE_IDS.verify,
            WORKFLOW_NODE_IDS.select,
            WORKFLOW_NODE_IDS.generate,
            WORKFLOW_NODE_IDS.export,
            WORKFLOW_NODE_IDS.end
          ];
      assert.deepEqual(nodes.map(node => node.id), expectedIds);
      assert.equal(uniquePositions.size, nodes.length, 'template nodes should not share the same canvas position');
      assert.ok(maxY - minY <= 80, `template ${template.id} should read as a single horizontal pipeline`);
      assert.ok(maxX - minX <= 1820, `template ${template.id} should not keep legacy wide spacing`);
      assert.deepEqual(nodes.map(node => node.data.stepIndex), nodes.map((_, index) => index + 1));
      assert.deepEqual(nodes.map(node => node.data.stepTotal), nodes.map(() => nodes.length));
      for (let index = 0; index < nodes.length; index += 1) {
        if (index > 0) {
          assert.ok(
            nodes[index].position.x > nodes[index - 1].position.x,
            `template ${template.id} node ${nodes[index].id} should be placed after ${nodes[index - 1].id}`
          );
        }
        for (let other = index + 1; other < nodes.length; other += 1) {
          const a = nodes[index].position;
          const b = nodes[other].position;
          const separatedHorizontally = Math.abs(a.x - b.x) >= nodeWidth + minGap;
          const separatedVertically = Math.abs(a.y - b.y) >= nodeHeight + minGap;
          assert.ok(
            separatedHorizontally || separatedVertically,
            `template nodes ${nodes[index].id} and ${nodes[other].id} are too close`
          );
        }
      }
    }
  });

  it('validates production workflow graphs without the legacy node registry', () => {
    const templates = listProductionWorkflowTemplates();
    const [template, keywordTemplate] = templates;

    assert.deepEqual(validateProductionWorkflow(template.workflow), {
      ok: true,
      errors: [],
      production: true,
      templateId: 'daily-selection-v1'
    });
    assert.deepEqual(validateProductionWorkflow(keywordTemplate.workflow), {
      ok: true,
      errors: [],
      production: true,
      templateId: 'exact-keyword-v1'
    });

    const invalid = validateProductionWorkflow({
      nodes: [{ id: 'start', type: 'production-start', data: {} }],
      edges: []
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.production, true);
    assert.ok(invalid.errors.some(error => error.code === 'production_template_mismatch'));
  });

  it('resolves legacy workflow launch from template or keyword-bearing nodes', () => {
    const templates = listProductionWorkflowTemplates();
    assert.deepEqual(resolveProductionWorkflowLaunch({
      templateId: 'daily-selection-v1',
      params: { mine: 3 }
    }), {
      mode: 'daily',
      params: { mine: 3 }
    });

    assert.deepEqual(resolveProductionWorkflowLaunch({
      workflow: {
        nodes: [
          { id: 'node_1', type: 'keyword-input', data: { keyword: '  纯银耳环  ' } }
        ],
        edges: []
      }
    }), {
      mode: 'keyword',
      params: { keyword: '纯银耳环' }
    });

    assert.deepEqual(resolveProductionWorkflowLaunch({
      workflow: {
        nodes: [
          { id: 'start', type: 'production-start', data: { keywordsText: '纯银耳环\n桌面收纳盒\n纯银耳环' } }
        ],
        edges: []
      }
    }), {
      mode: 'keyword',
      params: {
        keyword: '纯银耳环',
        keywords: ['纯银耳环', '桌面收纳盒']
      }
    });

    assert.deepEqual(resolveProductionWorkflowLaunch({
      workflow: templates[0].workflow
    }), {
      mode: 'daily',
      params: {}
    });

    assert.throws(() => resolveProductionWorkflowLaunch({
      workflow: { nodes: [{ id: 'node_1', type: 'keyword-input', data: {} }], edges: [] }
    }), /无法从工作流解析启动模式/);
    assert.throws(() => resolveProductionWorkflowLaunch({ templateId: 'missing-template' }), /未知 workflow template/);
  });

  it('prefers extracted keyword mode for legacy production workflow launch without explicit mode or template', () => {
    const [template] = listProductionWorkflowTemplates();
    const workflow = JSON.parse(JSON.stringify(template.workflow));
    workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start).data.keyword = '纯银项链';

    const launch = resolveProductionWorkflowLaunch({ workflow });
    const args = buildPipelineCliArgs(launch.mode, launch.params);

    assert.deepEqual(launch, {
      mode: 'keyword',
      params: { keyword: '纯银项链' }
    });
    assert.deepEqual(args.slice(0, 4), ['bin/cli.js', 'flow', 'keyword', '纯银项链']);
  });

  it('sanitizes daily and exact keyword parameters with range limits', () => {
    assert.deepEqual(sanitizeWorkflowParams('daily', {
      mine: '999',
      verify: '0',
      generate: 'abc',
      export: 200,
      productsPerKeyword: -1,
      length: 120,
      port: '9223',
      pages: 9,
      minBlueRows: '-5',
      fallbackHot: false,
      source: 'invalid',
      rootMode: 'invalid',
      rootLimit: '99',
      rootCooldownDays: '-4',
      maxObservingSeeds: '99',
      maxNewSeeds: '-2',
      autoReplenishSeeds: false,
      recordSeedFeedback: false
    }), {
      mine: 200,
      discoveryMode: 'inspiration',
      source: 'inspiration',
      rootMode: 'auto',
      rootLimit: 20,
      rootCooldownDays: 0,
      familyCooldownDays: 7,
      inspirationSycmPages: 1,
      inspirationUseLLM: true,
      maxObservingSeeds: 10,
      maxObservingPoolSize: 24,
      maxNewSeeds: 0,
      autoReplenishSeeds: false,
      recordSeedFeedback: false,
      verify: 1,
      select: 10,
      generate: 10,
      export: 100,
      productsPerKeyword: 1,
      length: 80,
      port: 9223,
      pages: 5,
      minBlueRows: 0,
      fallbackHot: false,
      autoApproveKeywords: true,
      autoExpandVerify: true,
      verifyReserve: 8,
      autoAllowReviewKeywords: true,
      reviewKeywordLimit: 2
    });

    assert.deepEqual(sanitizeWorkflowParams('keyword', {
      keyword: '  纯银项链女  ',
      export: 0,
      productsPerKeyword: 18,
      length: 20,
      port: '9222',
      pages: 2,
      minBlueRows: 3,
      fallbackHot: true
    }), {
      keyword: '纯银项链女',
      export: 1,
      productsPerKeyword: 18,
      length: 30,
      port: 9222,
      pages: 2,
      minBlueRows: 3,
      fallbackHot: true
    });

    assert.deepEqual(sanitizeWorkflowParams('keyword', {
      keywords: [' 纯银项链女 ', '桌面收纳盒', '纯银项链女']
    }), {
      keyword: '纯银项链女',
      keywords: ['纯银项链女', '桌面收纳盒'],
      export: 20,
      productsPerKeyword: 12,
      length: 60,
      port: 9222,
      pages: 1,
      minBlueRows: 1,
      fallbackHot: true
    });

    assert.throws(() => sanitizeWorkflowParams('keyword', { keyword: '   ' }), /关键词不能为空/);
    assert.deepEqual(sanitizeWorkflowParams('manual', {
      defaultKeyword: ' 法式连衣裙 ',
      items: [
        { url: 'https://detail.1688.com/offer/123456.html?spm=test' },
        { keyword: '碎花连衣裙', url: 'https://detail.m.1688.com/page/index.htm?offerId=789012' }
      ],
      export: 200,
      length: 20
    }), {
      defaultKeyword: '法式连衣裙',
      items: [
        { clientId: 'manual-123456', keyword: '法式连衣裙', url: 'https://detail.1688.com/offer/123456.html', offerId: '123456', title: '', category: '' },
        { clientId: 'manual-789012', keyword: '碎花连衣裙', url: 'https://detail.1688.com/offer/789012.html', offerId: '789012', title: '', category: '' }
      ],
      export: 100,
      length: 30
    });
    assert.throws(() => sanitizeWorkflowParams('manual', {
      defaultKeyword: '法式连衣裙',
      items: [
        { url: 'https://detail.1688.com/offer/123456.html' },
        { url: 'https://detail.1688.com/offer/123456.html?spm=duplicate' }
      ]
    }), /商品重复/);
    assert.throws(() => sanitizeWorkflowParams('manual', { items: [] }), /1688 商品链接/);
    assert.deepEqual(sanitizeWorkflowParams('order-sheet', {
      port: 9223,
      dateMode: 'custom',
      startDate: '2026-08-05',
      endDate: '2026-08-09',
      orderDate: '2026-08-12',
      storeName: '竹里人',
      sheetType: 'review',
      pages: 9,
      sortMetric: 'payAmt'
    }), {
      port: 9223,
      dateMode: 'custom',
      startDate: '2026-08-05',
      endDate: '2026-08-09',
      orderDate: '2026-08-12',
      storeName: '竹里人',
      sheetType: 'order',
      pages: 5,
      sortMetric: 'payAmt',
      productLimit: 0,
      fileName: '',
      includeRawData: true,
      includeImages: true,
      amountMode: 'average',
      missingAmountPolicy: 'blank',
      cartQuantity: 1,
      rowSpan: 3,
      workRequirement: '',
      orderNote: '',
      reviewGroupSize: 4,
      includeSpacerRow: true
    });
    assert.deepEqual(sanitizeWorkflowParams('review-sheet', {
      uploadId: '2f9e14d8-57f0-4c12-b2bd-f5efc3e34721',
      uploadName: '竹里人动销一拖多.xlsx',
      groups: [{
        id: 'group-1',
        orderDate: '2026-08-13',
        storeName: '竹里人',
        buyerName: '买家一',
        buyerPhone: '13800000001',
        orderNumber: 'ORDER-1',
        products: [{ title: '不应进入启动参数' }]
      }],
      reviewTone: '生活化',
      reviewLength: 120,
      useAI: false,
      fileName: '评价表'
    }), {
      uploadId: '2f9e14d8-57f0-4c12-b2bd-f5efc3e34721',
      uploadName: '竹里人动销一拖多.xlsx',
      groups: [{
        id: 'group-1',
        orderDate: '2026-08-13',
        storeName: '竹里人',
        buyerName: '买家一',
        buyerPhone: '13800000001',
        orderNumber: 'ORDER-1'
      }],
      reviewTone: '生活化',
      reviewLength: 100,
      useAI: false,
      fileName: '评价表',
      includeSpacerRow: true,
      sheetType: 'review'
    });
    assert.throws(() => sanitizeWorkflowParams('review-sheet', {}), /请先上传刷单表/);
    assert.throws(() => sanitizeWorkflowParams('order-sheet', {
      dateMode: 'custom',
      startDate: '2026-07-01',
      endDate: '2026-08-09'
    }), /最多选择 31 天/);
    assert.throws(() => sanitizeWorkflowParams('order-sheet', {
      orderDate: '2026-02-30'
    }), /刷单日期无效/);
    assert.throws(() => sanitizeWorkflowParams('unknown', {}), /未知 workflow mode/);
  });

  it('builds shell-free CLI args for production pipeline modes', () => {
    assert.deepEqual(buildPipelineCliArgs('daily', sanitizeWorkflowParams('daily', {
      mine: 20,
      verify: 5,
      generate: 3,
      export: 8,
      productsPerKeyword: 4,
      length: 60,
      port: 9222,
      pages: 1,
      minBlueRows: 1,
      fallbackHot: false
    })), [
      'bin/cli.js',
      'flow',
      'daily',
      '--mine', '20',
      '--discovery-mode', 'inspiration',
      '--source', 'inspiration',
      '--root-mode', 'auto',
      '--root-limit', '8',
      '--root-cooldown-days', '14',
      '--family-cooldown-days', '7',
      '--verify', '5',
      '--generate', '3',
      '--export', '8',
      '--products-per-keyword', '4',
      '--length', '60',
      '--port', '9222',
      '--pages', '1',
      '--min-blue-rows', '1',
      '--verify-reserve', '8',
      '--no-hot-fallback',
      '--json'
    ]);

    assert.deepEqual(buildPipelineCliArgs('keyword', sanitizeWorkflowParams('keyword', {
      keyword: '纯银 项链',
      export: 8,
      productsPerKeyword: 4,
      length: 60,
      port: 9222,
      pages: 1,
      minBlueRows: 1
    })), [
      'bin/cli.js',
      'flow',
      'keyword',
      '纯银 项链',
      '--export', '8',
      '--products-per-keyword', '4',
      '--length', '60',
      '--port', '9222',
      '--pages', '1',
      '--min-blue-rows', '1',
      '--json'
    ]);

    const batchKeywordArgs = buildPipelineCliArgs('keyword', {
      keywords: ['纯银项链', '桌面收纳盒']
    });
    assert.equal(batchKeywordArgs[3], '纯银项链\n桌面收纳盒');
  });

  it('rejects unknown modes and never emits shell-like numeric params in CLI args', () => {
    assert.throws(() => buildPipelineCliArgs('unknown', {}), /未知 workflow mode/);

    const args = buildPipelineCliArgs('daily', {
      mine: '20; touch /tmp/pwned',
      verify: '5 && whoami',
      generate: '3$(whoami)',
      export: '`id`',
      productsPerKeyword: '4 | cat',
      length: '60',
      port: '9222',
      pages: '1',
      minBlueRows: '1'
    });

    assert.equal(args.some(arg => /[;&|`$()]/.test(arg)), false);
    for (const flag of ['--mine', '--verify', '--generate', '--export', '--products-per-keyword']) {
      const value = args[args.indexOf(flag) + 1];
      assert.match(value, /^\d+$/, `${flag} should be a plain numeric spawn argument`);
    }
  });

  it('maps pipeline summary into workflow run node states and action metadata', () => {
    const summary = {
      runId: 'review_run',
      status: 'needs_review',
      stage: 'review',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: {
        candidates: 2,
        sycmVerified: 1,
        generatedProducts: 1,
        readyToDistribute: 1,
        reviewCandidates: 1
      },
      diversity: {
        keyword: { familyCount: 2, newFamilyCount: 1 },
        product: { uniqueOffers: 1, newOffers: 1, suppliers: 1 }
      },
      policy: { version: 2, productGate: 'strict' },
      funnel: { export: { input: 2, passed: 1, review: 1 } },
      failureReasons: { export: { product_opportunity_manual_review: 1 } },
      files: {
        candidates: '/tmp/candidates.jsonl',
        verifiedKeywords: '/tmp/verified-keywords.jsonl',
        generatedProducts: '/tmp/generated-products.jsonl',
        distributionBatch: '/tmp/distribution-batch.txt',
        distributionReview: '/tmp/distribution-review.md'
      },
      batchCount: 1,
      requiresUserAction: true,
      blockers: ['review_rejected_rows'],
      nextCommand: 'Review /tmp/distribution-review.md',
      nextActionCode: 'review_required'
    };

    const run = pipelineSummaryToWorkflowRun(summary);

    assert.equal(run.runId, 'review_run');
    assert.equal(run.status, 'needs_review');
    assert.equal(run.workflow.id, 'daily-selection-v1');
    assert.equal(run.requiresUserAction, true);
    assert.deepEqual(run.policy, { version: 2, productGate: 'strict' });
    assert.deepEqual(run.funnel.export, { input: 2, passed: 1, review: 1 });
    assert.deepEqual(run.failureReasons.export, { product_opportunity_manual_review: 1 });
    assert.deepEqual(run.blockers, ['review_rejected_rows']);
    assert.equal(run.nodeStates.start.status, 'completed');
    assert.equal(run.nodeStates.mine.status, 'completed');
    assert.equal(run.nodeStates.verify.status, 'completed');
    assert.equal(run.nodeStates.generate.status, 'completed');
    assert.equal(run.nodeStates.export.status, 'needs_review');
    assert.equal(run.nodeStates.end.status, 'idle');
    assert.equal(run.nodeStates.mine.output.count, 2);
    assert.equal(run.nodeStates.mine.output.diversity.familyCount, 2);
    assert.equal(run.nodeStates.select.output.diversity.newOffers, 1);
    assert.equal(run.nodeStates.export.output.reviewFile, '/tmp/distribution-review.md');
  });

  it('attaches runtime state and maps runtime progress into workflow node states', () => {
    const dataDir = tempPipelineDir();
    const runId = 'runtime_progress_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'created',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:01:00.000Z',
      counts: {},
      files: {}
    });
    writeJson(path.join(runDir, 'runtime.json'), {
      status: 'running',
      activeStep: WORKFLOW_NODE_IDS.verify,
      steps: ['mine', 'verify', 'generate', 'export', 'review'],
      progress: {
        mine: { status: 'completed', current: 3, total: 3, percent: 100, message: '挖词完成' },
        verify: { status: 'running', current: 2, total: 5, percent: 40, message: '验真 2/5' }
      },
      startedAt: '2026-06-29T04:00:05.000Z',
      updatedAt: '2026-06-29T04:01:30.000Z'
    });

    const run = getWorkflowRun({ dataDir, runId });

    assert.equal(run.runtime.status, 'running');
    assert.equal(run.runtime.activeStep, WORKFLOW_NODE_IDS.verify);
    assert.equal(run.nodeStates.mine.status, 'completed');
    assert.deepEqual(run.nodeStates.mine.progress, {
      status: 'completed',
      current: 3,
      total: 3,
      percent: 100,
      message: '挖词完成'
    });
    assert.equal(run.nodeStates.verify.status, 'running');
    assert.equal(run.nodeStates.verify.progress.percent, 40);
    assert.equal(run.nodeStates.verify.progress.message, '验真 2/5');
    assert.equal(run.nodeStates.generate.status, 'idle');
  });

  it('maps paused runtime state to the active pipeline node', () => {
    const dataDir = tempPipelineDir();
    const runId = 'paused_runtime_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'mined',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:01:00.000Z',
      counts: {},
      files: {}
    });
    writeJson(path.join(runDir, 'runtime.json'), {
      status: 'paused',
      activeStep: WORKFLOW_NODE_IDS.verify,
      steps: ['mine', 'verify', 'generate', 'export', 'review'],
      progress: {
        mine: { status: 'completed', current: 1, total: 1, percent: 100, message: '完成' }
      }
    });

    const run = getWorkflowRun({ dataDir, runId });

    assert.equal(run.nodeStates.verify.status, 'paused');
    assert.equal(run.nodeStates.verify.progress.status, 'paused');
    assert.equal(run.status, 'paused');
  });

  it('surfaces summary blocker guidance when runtime only reports a blocked step', () => {
    const dataDir = tempPipelineDir();
    const runId = 'verified_empty_runtime_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'verified_empty',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:01:00.000Z',
      counts: {
        candidates: 1,
        sycmVerified: 0,
        sycmRejected: 1
      },
      files: {}
    });
    writeJson(path.join(runDir, 'runtime.json'), {
      status: 'blocked',
      activeStep: WORKFLOW_NODE_IDS.verify,
      steps: ['mine', 'verify', 'generate', 'export', 'review'],
      progress: {
        mine: { status: 'completed', current: 1, total: 1, percent: 100, message: '完成' },
        verify: { status: 'completed', current: 1, total: 1, percent: 100, message: '完成' }
      }
    });

    const run = getWorkflowRun({ dataDir, runId });

    assert.equal(run.status, 'blocked');
    assert.equal(run.nodeStates.verify.status, 'blocked');
    assert.equal(run.nodeStates.verify.blocker, 'verified_empty');
    assert.match(run.nodeStates.verify.actionHint, /验真没有通过词/);
    assert.match(run.nodeStates.verify.actionHint, /重新挖词/);
    assert.deepEqual(run.nodeStates.verify.nextRecommendedAction, {
      action: 'mine-more',
      label: '补充候选词',
      description: '当前没有通过生意参谋验真的词，先补充候选词再重跑验真。'
    });
  });

  it('keeps inspiration SYCM connection failures on the mining node', () => {
    const dataDir = tempPipelineDir();
    const runId = 'mining_chrome_failure_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'mining_manual_action_required',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:01:00.000Z',
      counts: { candidates: 0, inspirations: 8, selectedRoots: 2 },
      discovery: {
        mode: 'inspiration',
        blocker: 'sycm_chrome_unavailable',
        blockerReason: 'No Chrome tab found on port 9222'
      },
      files: {}
    });

    const run = getWorkflowRun({ dataDir, runId });

    assert.equal(run.nodeStates.mine.status, 'blocked');
    assert.equal(run.nodeStates.keywordReview.status, 'idle');
    assert.equal(run.nodeStates.mine.blocker, 'sycm_chrome_unavailable');
    assert.match(run.nodeStates.mine.actionHint, /No Chrome tab/);
    assert.equal(run.nodeStates.mine.nextRecommendedAction.action, 'start-sycm-chrome');
  });

  it('surfaces SYCM CDP failures from sycm results instead of generic empty verification guidance', () => {
    const dataDir = tempPipelineDir();
    const runId = 'sycm_cdp_failure_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'verified_empty',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:01:00.000Z',
      counts: {
        candidates: 1,
        sycmVerified: 0,
        sycmRejected: 1
      },
      files: {
        sycmResults: path.join(runDir, 'sycm-results.jsonl'),
        verifiedKeywords: path.join(runDir, 'verified-keywords.jsonl')
      }
    });
    writeJson(path.join(runDir, 'runtime.json'), {
      status: 'blocked',
      activeStep: WORKFLOW_NODE_IDS.verify,
      steps: ['mine', 'verify', 'generate', 'export', 'review'],
      progress: {
        verify: { status: 'completed', current: 1, total: 1, percent: 100, message: '完成' }
      }
    });
    writeText(path.join(runDir, 'sycm-results.jsonl'), JSON.stringify({
      keyword: '纯银项链',
      ok: false,
      status: 'transient_failure',
      error: 'connect ECONNREFUSED 127.0.0.1:9222',
      manualAction: {
        status: 'transient_failure',
        userMessage: '生意参谋暂时访问失败，可稍后重试。'
      }
    }) + '\n');

    const run = getWorkflowRun({ dataDir, runId });

    assert.equal(run.nodeStates.verify.status, 'blocked');
    assert.equal(run.nodeStates.verify.blocker, 'sycm_transient_failure');
    assert.equal(run.nodeStates.verify.platform, 'sycm');
    assert.equal(run.nodeStates.verify.platformStatus, 'transient_failure');
    assert.match(run.nodeStates.verify.actionHint, /Chrome CDP 不可用/);
    assert.match(run.nodeStates.verify.actionHint, /9222/);
    assert.deepEqual(run.nodeStates.verify.nextRecommendedAction, {
      action: 'start-sycm-chrome',
      label: '启动 Chrome',
      description: '启动带远程调试端口的 Chrome，登录生意参谋后重试校验。'
    });
  });

  it('maps missing Chrome tab cooldown errors to a Chrome startup action', () => {
    const dataDir = tempPipelineDir();
    const runId = 'sycm-no-chrome-tab-run';
    const runDir = path.join(dataDir, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      runId,
      status: 'manual_action_required',
      stage: 'verified',
      files: { sycmResults: path.join(runDir, 'sycm-results.jsonl') }
    }));
    fs.writeFileSync(path.join(runDir, 'sycm-results.jsonl'), JSON.stringify({
      ok: false,
      status: 'transient_failure',
      error: 'sycm access is cooling down: No Chrome tab found on port 9222'
    }) + '\n');

    const run = getWorkflowRun({ dataDir, runId });

    assert.equal(run.nodeStates.verify.status, 'blocked');
    assert.match(run.nodeStates.verify.actionHint, /Chrome CDP 不可用/);
    assert.equal(run.nodeStates.verify.nextRecommendedAction.action, 'start-sycm-chrome');
  });

  it('maps explicit pipeline statuses to production node states', () => {
    const cases = [
      {
        status: 'manual_action_required',
        stage: 'verified',
        expected: { verify: 'blocked', generate: 'idle', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'verified_partial_manual_required',
        stage: 'verified',
        expected: { verify: 'blocked', generate: 'idle', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'verified_empty',
        stage: 'verified',
        expected: { verify: 'blocked', generate: 'idle', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'generate_failed',
        stage: 'generated',
        expected: { verify: 'completed', generate: 'failed', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'needs_review',
        stage: 'review',
        expected: { export: 'needs_review', review: 'idle', end: 'idle' }
      },
      {
        status: 'ready_to_distribute',
        stage: 'ready',
        expected: { export: 'waiting_confirmation', review: 'idle', end: 'idle' }
      },
      {
        status: 'awaiting_user_confirmation',
        stage: 'ready',
        expected: { export: 'waiting_confirmation', review: 'idle', end: 'idle' }
      },
      {
        status: 'workflow_complete',
        stage: 'submitted',
        expected: {
          start: 'completed',
          mine: 'completed',
          verify: 'completed',
          generate: 'completed',
          export: 'completed',
          review: 'completed',
          end: 'completed'
        }
      }
    ];

    for (const item of cases) {
      const run = pipelineSummaryToWorkflowRun({
        runId: `${item.status}_run`,
        status: item.status,
        stage: item.stage,
        startedAt: '2026-06-29T04:00:00.000Z',
        updatedAt: '2026-06-29T04:10:00.000Z',
        counts: { candidates: 2, sycmVerified: 1, generatedProducts: 1, readyToDistribute: 1 },
        files: {}
      });

      for (const [nodeId, expectedStatus] of Object.entries(item.expected)) {
        assert.equal(run.nodeStates[nodeId].status, expectedStatus, `${item.status} maps ${nodeId}`);
      }
    }
  });

  it('shows the actual MiniMax title-generation failure instead of a stale GLM hint', () => {
    const run = pipelineSummaryToWorkflowRun({
      runId: 'minimax_generate_failed',
      status: 'generate_failed',
      stage: 'generated',
      counts: { generatedProducts: 0 },
      files: {},
      previews: {
        generatedProducts: [{
          status: 'generate_failed',
          error: '标题生成超时(120s)，请简化关键词或减少数量',
          code: 'title_generation_timeout',
          llmProvider: 'minimax',
          llmModel: 'MiniMax-M3'
        }]
      }
    });

    assert.match(run.nodeStates.generate.actionHint, /MiniMax（MiniMax-M3）/);
    assert.match(run.nodeStates.generate.actionHint, /标题生成超时\(120s\)/);
    assert.doesNotMatch(run.nodeStates.generate.actionHint, /检查 GLM 配置/);
    assert.equal(run.nodeStates.generate.nextRecommendedAction.action, 'retry-node');
  });

  it('lists, gets, and reads workflow node artifacts from pipeline runs', () => {
    const dataDir = tempPipelineDir();
    const runId = 'artifact_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'generated',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: { candidates: 2, sycmVerified: 1, generatedProducts: 1 },
      discovery: { mode: 'inspiration', stats: { inspirationCount: 1, selectedRootCount: 1 } },
      files: {
        candidates: path.join(runDir, 'candidates.jsonl'),
        inspirations: path.join(runDir, 'inspirations.jsonl'),
        rootCandidates: path.join(runDir, 'root-candidates.jsonl'),
        verifiedKeywords: path.join(runDir, 'verified-keywords.jsonl'),
        generatedProducts: path.join(runDir, 'generated-products.jsonl')
      }
    });
    writeText(path.join(runDir, 'candidates.jsonl'), '{"keyword":"项链"}\n{"keyword":"耳环"}\n');
    writeText(path.join(runDir, 'inspirations.jsonl'), '{"id":"insp-1","inspirationWord":"通勤"}\n');
    writeText(path.join(runDir, 'root-candidates.jsonl'), '{"rootKeyword":"项链","status":"selected"}\n');
    writeText(path.join(runDir, 'verified-keywords.jsonl'), '{"keyword":"项链","status":"verified"}\n');
    writeText(path.join(runDir, 'generated-products.jsonl'), '{"title":"纯银项链"}\n');

    const listed = listWorkflowRuns({ dataDir });
    const run = getWorkflowRun({ dataDir, runId });
    const legacyRun = getWorkflowRun(runId, { dataDir });
    const startArtifact = readWorkflowNodeArtifact({ dataDir, runId, nodeId: WORKFLOW_NODE_IDS.start });
    const mineArtifact = readWorkflowNodeArtifact({ dataDir, runId, nodeId: WORKFLOW_NODE_IDS.mine });
    const generateArtifact = readWorkflowNodeArtifact({ dataDir, runId, nodeId: WORKFLOW_NODE_IDS.generate });

    assert.equal(listed.latest.runId, runId);
    assert.equal(legacyRun.runId, runId);
    assert.equal(run.nodeStates.generate.status, 'completed');
    assert.equal(run.nodeStates.export.status, 'running');
    assert.equal(startArtifact, null);
    assert.deepEqual(mineArtifact.rows.map(row => row.keyword), ['项链', '耳环']);
    assert.deepEqual(mineArtifact.inspirationRows.map(row => row.inspirationWord), ['通勤']);
    assert.deepEqual(mineArtifact.rootRows.map(row => row.rootKeyword), ['项链']);
    assert.equal(mineArtifact.discovery.mode, 'inspiration');
    assert.deepEqual(generateArtifact.rows, [{ title: '纯银项链' }]);
    assert.equal(readWorkflowNodeArtifact({ dataDir, runId, nodeId: WORKFLOW_NODE_IDS.end }), null);
  });

  it('deletes pipeline workflow run directories and clears latest pointer', () => {
    const dataDir = tempPipelineDir();
    const runId = 'delete_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'mined',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: { candidates: 1 },
      files: { candidates: path.join(runDir, 'candidates.jsonl') }
    });
    writeJson(path.join(dataDir, 'latest.json'), { runId, runDir, updatedAt: '2026-06-29T04:10:00.000Z' });
    writeText(path.join(runDir, 'candidates.jsonl'), '{"keyword":"项链"}\n');

    const result = deleteWorkflowRun({ dataDir, runId });

    assert.equal(result.ok, true);
    assert.equal(result.deleted.pipelineRun, true);
    assert.equal(fs.existsSync(runDir), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'latest.json')), false);
    assert.equal(getWorkflowRun({ dataDir, runId }), null);
  });

  it('persists workflow definitions and events next to pipeline runs', () => {
    const dataDir = tempPipelineDir();
    const runId = 'snapshot_run-1';
    const definition = {
      nodes: [{ id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '开始' } }],
      edges: []
    };
    const event = {
      type: 'node_moved',
      nodeId: WORKFLOW_NODE_IDS.start,
      position: { x: 24, y: 48 }
    };

    const definitionFile = writeWorkflowDefinition({ dataDir, runId, definition });
    const eventFile = appendWorkflowEvent({ dataDir, runId, event });

    assert.equal(definitionFile, path.join(dataDir, 'runs', runId, 'workflow-definition.json'));
    assert.equal(eventFile, path.join(dataDir, 'runs', runId, 'workflow-events.jsonl'));
    assert.deepEqual(JSON.parse(fs.readFileSync(definitionFile, 'utf8')), definition);
    assert.deepEqual(readWorkflowDefinition({ dataDir, runId }), definition);
    assert.deepEqual(readWorkflowEvents({ dataDir, runId }), [event]);
  });

  it('restores the persisted workflow snapshot when mapping run history', () => {
    const dataDir = tempPipelineDir();
    const runId = 'snapshot_history_run';
    const template = listProductionWorkflowTemplates().find(item => item.mode === 'daily');
    const definition = {
      id: template.id,
      mode: template.mode,
      nodes: template.workflow.nodes.map((node, index) => ({
        ...node,
        position: { x: 100 + index * 280, y: 240 },
        data: { ...node.data, snapshotMarker: `node-${index}` }
      })),
      edges: template.workflow.edges
    };
    writeWorkflowDefinition({ dataDir, runId, definition });

    const run = pipelineSummaryToWorkflowRun({
      runId,
      status: 'created',
      options: { mode: 'daily' },
      counts: {},
      files: {}
    }, { dataDir });

    assert.deepEqual(run.workflow, definition);
    assert.equal(run.workflow.nodes[0].position.y, 240);
    assert.equal(run.workflow.nodes[0].data.snapshotMarker, 'node-0');
  });

  it('resolves a validated workflow snapshot and rejects template mismatches', () => {
    const templates = listProductionWorkflowTemplates();
    const daily = templates.find(item => item.mode === 'daily');
    const launch = resolveProductionWorkflowLaunch({
      templateId: daily.id,
      mode: daily.mode,
      workflow: daily.workflow,
      params: { mine: 12 }
    });

    const definition = resolveProductionWorkflowDefinition({
      templateId: daily.id,
      workflow: daily.workflow
    }, launch);
    assert.equal(definition.id, daily.id);
    assert.equal(definition.mode, 'daily');
    assert.deepEqual(definition.nodes, daily.workflow.nodes);

    assert.throws(() => resolveProductionWorkflowDefinition({
      templateId: 'exact-keyword-v1',
      workflow: daily.workflow
    }, launch), /工作流定义与所选模板不一致/);
  });

  it('rejects unsafe workflow run ids for snapshots and events', () => {
    const dataDir = tempPipelineDir();

    assert.throws(() => writeWorkflowDefinition({
      dataDir,
      runId: '../outside',
      definition: { nodes: [], edges: [] }
    }), /Invalid workflow run id/);
    assert.throws(() => appendWorkflowEvent({
      dataDir,
      runId: 'bad/run',
      event: { type: 'node_moved' }
    }), /Invalid workflow run id/);
    assert.throws(() => readWorkflowEvents({
      dataDir,
      runId: 'bad.run'
    }), /Invalid workflow run id/);
  });

  it('attaches persisted workflow events to workflow run details', () => {
    const dataDir = tempPipelineDir();
    const runId = 'eventful_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'created',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:01:00.000Z',
      counts: {},
      files: {}
    });
    appendWorkflowEvent({ dataDir, runId, event: { type: 'node_selected', nodeId: WORKFLOW_NODE_IDS.mine } });
    appendWorkflowEvent({ dataDir, runId, event: { type: 'viewport_changed', zoom: 0.8 } });

    const run = getWorkflowRun({ dataDir, runId });

    assert.deepEqual(run.workflowEvents, [
      { type: 'node_selected', nodeId: WORKFLOW_NODE_IDS.mine },
      { type: 'viewport_changed', zoom: 0.8 }
    ]);
  });

  it('attaches distribution review actions to the merged export node', () => {
    const reviewRun = pipelineSummaryToWorkflowRun({
      runId: 'needs_review_action_run',
      status: 'needs_review',
      stage: 'review',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: { readyToDistribute: 1 },
      files: {}
    });

    assert.deepEqual(reviewRun.nodeStates.export.nextRecommendedAction, {
      action: 'open-review',
      label: '处理铺货复核',
      description: '查看自动清单、拦截原因，并人工加入可铺货项。'
    });

    const readyRun = pipelineSummaryToWorkflowRun({
      runId: 'ready_confirm_action_run',
      status: 'ready_to_distribute',
      stage: 'ready',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: { readyToDistribute: 2 },
      files: {}
    });

    assert.deepEqual(readyRun.nodeStates.export.nextRecommendedAction, {
      action: 'confirm-distribution',
      label: '确认铺货清单',
      description: '铺货前必须人工确认具体商品清单，确认后再进入提交动作。'
    });
  });
});
