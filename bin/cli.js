#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const { run } = require('../src');
const { batchRun } = require('../src/batch');
const { formatResult } = require('../src/output-formatter');
const { byteLen } = require('../src/title-utils');
const fs = require('fs');
const path = require('path');

const program = new Command();

program
  .name('my-title')
  .description('电商选品标题生成工具 - 关键词 → GLM提取 → 1688搜索 → 相关性过滤 → 生成淘宝标题（可参考淘宝同行标题）')
  .argument('[keywords]', '用户输入关键词，如"纯银项链女高级感"')
  .option('-l, --length <number>', '标题最大长度（字符，1汉字=2字符）', '60')
  .option('-c, --count <number>', '输出候选标题数量', '3')
  .option('-p, --peer-titles <titles>', '手动提供淘宝同行标题，逗号分隔')
  .option('-f, --peer-titles-file <path>', '从文件读取淘宝同行标题，每行一个')
  .option('--json', '纯 JSON 输出模式，抑制所有进度信息，适合程序调用')
  .option('--format <type>', '输出格式: table / json / both', 'both')
  .option('--research', '分析并推荐去生意参谋查哪些关键词')
  .option('--sycm-auto', '自动查询生意参谋蓝海数据（需要Chrome在调试模式运行）')
  .option('--keyword-file <path>', '加载生意参谋搜索分析数据文件')
  .option('--keywords <keywords>', '批量关键词模式（逗号分隔，如 "纯银项链女,925银手链"）')
  .option('--suggest', '自动选词模式：GLM推荐候选词 → SYCM验证 → 输出蓝海词列表')
  .option('--strategy <type>', '选词策略：crowd(人群) | scene(场景) | season(季节) | problem(痛点) | industry(行业)', 'season')
  .option('--input <text>', '策略输入（人群/场景/痛点/行业描述，season策略可省略）')
  .option('--max-candidates <number>', 'GLM最大候选词数量', '5')
  .action(async (keywords, options) => {
    const jsonMode = !!options.json;
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    if (jsonMode) {
      console.log = () => {};
      console.warn = () => {};
      console.error = () => {};
    }
    try {
      // 批量模式：--keywords 传入逗号分隔的多个关键词
      if (options.keywords) {
        const kwList = options.keywords.split(',').map(k => k.trim()).filter(Boolean);
        console.log(`🔄 批量选品模式：${kwList.length} 个关键词`);

        const result = await batchRun(kwList, {
          maxLength: parseInt(options.length) || 60,
          silent: jsonMode,
          sycmAuto: options.sycmAuto,
          onProgress: ({ completed, total, currentKeyword }) => {
            if (currentKeyword) {
              console.log(`  📋 进度: ${completed}/${total} — 当前: ${currentKeyword}`);
            }
          },
        });

        if (jsonMode) {
          console.log = origLog;
          console.warn = origWarn;
          console.error = origError;
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }

        // 输出每个关键词的结果
        for (const item of result.results) {
          console.log('\n' + '='.repeat(50));
          console.log(`📝 关键词: ${item.keyword} (核心词: ${item.coreWord})`);
          console.log(`  过滤后商品: ${item.filteredCount} 个`);
          if (item.titles && item.titles.length > 0) {
            console.log('  生成标题:');
            item.titles.forEach((t, i) => {
              const title = (!t || typeof t === 'string') ? (t || '') : (t.title || t['铺货标题'] || '');
              console.log(`    ${i + 1}. ${title}`);
            });
          } else {
            console.log('  ⚠️ 未生成标题');
          }
        }

        if (result.failed.length > 0) {
          console.log('\n' + '-'.repeat(50));
          console.log(`❌ 失败的关键词 (${result.failed.length} 个):`);
          result.failed.forEach(f => {
            console.log(`  - ${f.keyword}: ${f.error}`);
          });
        }

        console.log('\n' + '='.repeat(50));
        console.log(`📊 批量选品汇总:`);
        console.log(`  总计: ${result.summary.total} 个`);
        console.log(`  成功: ${result.summary.success} 个`);
        console.log(`  失败: ${result.summary.failed} 个`);
        console.log(`  去重核心词: ${result.summary.dedupedCoreWords} 个`);
        return;
      }

      // --suggest 模式：自动选词
      if (options.suggest) {
        const { suggestAndVerify, VALID_STRATEGIES } = require('../src/keyword-suggester');
        
        const strategy = options.strategy || 'season';
        if (!VALID_STRATEGIES.includes(strategy)) {
          if (jsonMode) {
            console.log = origLog;
            console.warn = origWarn;
            console.error = origError;
            process.stdout.write(JSON.stringify({
              ok: false,
              error: `无效策略 "${strategy}"。有效策略: ${VALID_STRATEGIES.join(', ')}`
            }, null, 2) + '\n');
          } else {
            console.error(`\n❌ 无效策略 "${strategy}"`);
            console.error(`有效策略: ${VALID_STRATEGIES.join(', ')}`);
          }
          process.exit(1);
          return;
        }
        
        // input: use --input if provided, otherwise use positional keywords argument
        const input = options.input || keywords || '';
        
        const suggestOptions = {
          strategy,
          input,
          maxCandidates: parseInt(options.maxCandidates) || 5,
          onProgress: (msg) => {
            if (!jsonMode) console.log(`  ${msg}`);
          }
        };
        
        const result = await suggestAndVerify(suggestOptions);
        
        if (jsonMode) {
          console.log = origLog;
          console.warn = origWarn;
          console.error = origError;
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }
        
        // Human-readable output
        if (!result.ok) {
          console.error(`\n❌ ${result.error}`);
          if (result.chromeLaunchCmd) {
            console.error(`\n请先用以下命令启动 Chrome：`);
            console.error(`  ${result.chromeLaunchCmd}`);
          }
          process.exit(1);
          return;
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🔍 自动选词结果');
        console.log(`策略: ${strategy} | 验证通过: ${result.verified} | 未通过: ${result.failed}`);
        console.log('-'.repeat(60));
        
        if (result.keywords && result.keywords.length > 0) {
          result.keywords.forEach((kw, i) => {
            console.log(`${i + 1}. ${kw.keyword}`);
            console.log(`   搜索人气: ${kw.searchPopularity} | 转化率: ${(kw.conversionRate * 100).toFixed(1)}% | 需求供给比: ${kw.demandSupplyRatio} | 天猫占比: ${(kw.tmallClickShare * 100).toFixed(1)}%`);
          });
        } else {
          console.log('未找到符合蓝海条件的关键词');
        }
        
        if (result.message) {
          console.log(`\n💡 ${result.message}`);
        }
        
        if (result.errors && result.errors.length > 0) {
          console.log('\n验证失败的关键词:');
          result.errors.forEach(e => {
            console.log(`  - ${e.keyword}: ${e.error}`);
          });
        }
        
        console.log();
        return;
      }

      // --research 模式：只分析并推荐关键词
      if (options.research) {
        const result = await run(keywords, {
          maxLength: parseInt(options.length),
          peerTitles: [],
          silent: jsonMode,
          limit: 0,
          research: true,
          sycmAuto: options.sycmAuto
        });

        if (jsonMode) {
          console.log = origLog;
          console.warn = origWarn;
          console.error = origError;
          process.stdout.write(JSON.stringify({
            researchKeywords: result.researchKeywords || [],
            coreWord: result.coreWord,
            modifiers: result.modifiers
          }, null, 2) + '\n');
          return;
        }

        console.log('\n📊 推荐去生意参谋查询以下关键词的搜索分析数据：');
        if (result.researchKeywords && result.researchKeywords.length > 0) {
          result.researchKeywords.forEach((kw, i) => {
            const tagMap = { '核心词': '(核心词)', '蓝海词': '(蓝海词)', '核心词+刚性修饰词': '(刚性修饰词组合)', '高频词': '(高频关联词)', '缺口词': '(缺口词)' };
            const tag = tagMap[kw.source] || '(关联词)';
            console.log(`  ${i + 1}. ${kw.word} ${tag}`);
          });
        }
        console.log('\n💡 将数据复制保存到文件后，使用 --keyword-file <文件路径> 重新运行');
        return;
      }

      // --keyword-file 模式：加载生意参谋数据
      let sycmData = null;
      if (options.keywordFile) {
        try {
          sycmData = fs.readFileSync(options.keywordFile, 'utf-8');
        } catch (err) {
          if (jsonMode) {
            process.stdout.write(JSON.stringify({ ok: false, error: `读取生意参谋数据文件失败: ${err.message}` }) + '\n');
          } else {
            console.error(`\n❌ 读取生意参谋数据文件失败: ${err.message}`);
          }
          process.exit(1);
        }
      }

      let peerTitles = [];
      if (options.peerTitles) {
        peerTitles = options.peerTitles.split(',').map(t => t.trim()).filter(Boolean);
      } else if (options.peerTitlesFile) {
        try {
          const content = fs.readFileSync(options.peerTitlesFile, 'utf8');
          peerTitles = content.split('\n').map(t => t.trim()).filter(Boolean);
        } catch (err) {
          if (jsonMode) {
            process.stdout.write(JSON.stringify({ ok: false, error: `读取同行标题文件失败: ${err.message}` }) + '\n');
          } else {
            console.error(`\n❌ 读取同行标题文件失败: ${err.message}`);
          }
          process.exit(1);
        }
      }

      const result = await run(keywords, {
        maxLength: parseInt(options.length),
        peerTitles,
        silent: jsonMode,
        limit: parseInt(options.count),
        sycmData,
        sycmAuto: options.sycmAuto
      });

      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        const output = {
          ok: true,
          coreWord: result.coreWord,
          blueOceanWord: result.blueOceanWord,
          modifiers: result.modifiers,
          filteredCount: result.filteredCount,
          titles: result.titles,
          products: result.products,
          stats: result.stats,
          peerTitles: result.peerTitles || []
        };
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        return;
      }

      console.log('\n✅ 处理完成');
      console.log('='.repeat(50));
      console.log(`核心词: ${result.coreWord}`);
      console.log(`过滤后商品: ${result.filteredCount} 个`);

      if (result.titles.length === 0) {
        console.log('\n❌ 没有生成标题，请尝试其他关键词');
        process.exit(1);
      }

      console.log('\n📝 生成的标题:');
      result.titles.forEach((title, index) => {
        console.log(`${index + 1}. ${title} (${byteLen(title)} 字符)`);
      });

      const outputFormat = options.format || 'both';
      console.log('\n' + formatResult(result.products, outputFormat));

      if (outputFormat === 'json') {
        const timestamp = Date.now();
        const safeKeyword = keywords.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
        const jsonPath = path.join('output', `${safeKeyword}_${timestamp}.json`);
        fs.mkdirSync('output', { recursive: true });
        fs.writeFileSync(jsonPath, formatResult(result.products, 'json'));
        console.log(`\n📄 JSON 已写入: ${jsonPath}`);
      }

      // 提示用户可以使用生意参谋数据增强
      if (!options.keywordFile && !options.research) {
        console.log('\n💡 提示: 使用生意参谋数据可获得更精准的选词和排序');
        console.log('   1. 先运行: node bin/cli.js "' + keywords + '" --research');
        console.log('   2. 复制生意参谋数据到文件后: node bin/cli.js "' + keywords + '" --keyword-file <文件路径>');
      }

      console.log();
    } catch (error) {
      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      } else {
        console.error('\n❌ 错误:', error.message);
      }
      process.exit(1);
    }
  });

program
  .command('image <url>')
  .description('从 1688 商品链接自动获取主图，以图搜图生成铺货标题')
  .option('-l, --length <number>', '标题最大长度', '60')
  .option('-c, --count <number>', '输出候选标题数量', '3')
  .option('--json', '纯 JSON 输出模式')
  .option('--format <type>', '输出格式: table / json / both', 'both')
  .action(async (url, options) => {
    const jsonMode = !!options.json;
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    if (jsonMode) {
      console.log = () => {};
      console.warn = () => {};
      console.error = () => {};
    }
    try {
      const result = await require('../src').runFromImage(url, {
        maxLength: parseInt(options.length),
        silent: jsonMode
      });

      if (result.ok === false) {
        if (jsonMode) {
          console.log = origLog;
          console.warn = origWarn;
          console.error = origError;
          process.stdout.write(JSON.stringify({ ok: false, error: result.error, step: result.step }) + '\n');
        } else {
          console.error(`\n❌ 错误[${result.step}]: ${result.error}`);
        }
        process.exit(1);
      }

      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        const output = {
          ok: true,
          sourceUrl: result.sourceUrl,
          imageUrl: result.imageUrl,
          originalTitle: result.originalTitle,
          coreWord: result.coreWord,
          blueOceanWord: result.blueOceanWord,
          titles: result.titles,
          peerTitles: result.peerTitles,
          peerSource: result.peerSource,
          stats: result.stats
        };
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        return;
      }

      console.log('\n✅ 处理完成');
      console.log('='.repeat(50));
      console.log(`来源链接: ${result.sourceUrl}`);
      console.log(`核心词: ${result.coreWord}`);
      console.log(`蓝海词: ${result.blueOceanWord}`);
      console.log(`原标题: ${result.originalTitle}`);

      if (result.titles.length === 0) {
        console.log('\n❌ 没有生成标题，请尝试其他链接');
        process.exit(1);
      }

      const outputFormat = options.format || 'both';
      
      if (outputFormat === 'table' || outputFormat === 'both') {
        console.log('\n📝 生成的标题:');
        const count = Math.min(parseInt(options.count), result.titles.length);
        result.titles.slice(0, count).forEach((title, index) => {
          console.log(`${index + 1}. ${title} (${byteLen(title)} 字符)`);
        });
      }

      if (outputFormat === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else if (outputFormat === 'both') {
        console.log();
        console.log(JSON.stringify(result, null, 2));
      }

      console.log();
    } catch (error) {
      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      } else {
        console.error('\n❌ 错误:', error.message);
      }
      process.exit(1);
    }
  });

program
  .command('opportunities')
  .description('获取 1688 商机热榜数据（1688/淘宝/小红书热门商品）')
  .option('--json', '纯 JSON 输出模式')
  .action(function(options, command) {
    const mainOpts = command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    if (jsonMode) {
      console.log = function(){};
      console.warn = function(){};
      console.error = function(){};
    }
    try {
      const Alibaba1688Client = require('../src/alibaba1688-client');
      const client = new Alibaba1688Client(process.env.ALI_1688_AK);
      return client.fetchOpportunities().then(function(result) {
        if (jsonMode) {
          console.log = origLog;
          console.warn = origWarn;
          console.error = origError;
          process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + '\n');
          return;
        }
        console.log('\n📊 1688 商机热榜');
        console.log('='.repeat(50));
        console.log(JSON.stringify(result, null, 2));
        console.log();
      }).catch(function(error) {
        if (jsonMode) {
          console.log = origLog;
          console.warn = origWarn;
          console.error = origError;
          process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
        } else {
          console.error('\n❌ 错误:', error.message);
        }
        process.exit(1);
      });
    } catch (error) {
      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      } else {
        console.error('\n❌ 错误:', error.message);
      }
      process.exit(1);
    }
  });

program
  .command('trend <query>')
  .description('获取指定品类的趋势洞察数据')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(query, options, command) {
    const mainOpts = command && command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    if (jsonMode) {
      console.log = () => {};
      console.warn = () => {};
      console.error = () => {};
    }
    try {
      const Alibaba1688Client = require('../src/alibaba1688-client');
      const client = new Alibaba1688Client(process.env.ALI_1688_AK);
      const result = await client.fetchTrend(query);

      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + '\n');
        return;
      }

      console.log('\n📈 趋势洞察: ' + query);
      console.log('='.repeat(50));
      console.log(JSON.stringify(result, null, 2));
      console.log();
    } catch (error) {
      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      } else {
        console.error('\n❌ 错误:', error.message);
      }
      process.exit(1);
    }
  });

program
  .command('sycm <keyword>')
  .description('查询生意参谋搜索分析数据（需要 Chrome 调试模式，自动提取前5页数据）')
  .option('--json', '纯 JSON 输出模式')
  .option('--port <number>', 'Chrome 调试端口', '9222')
  .option('--pages <number>', '最大提取页数（默认1）', '1')
  .option('--mode <hot|blue>', '查询模式，hot=相关热搜词，blue=相关蓝海词', 'blue')
  .option('--filter <conditions>', '过滤条件，格式: demandSupplyRatio=1,searchPopularity=1000')
  .option('--no-default-filters', '禁用默认过滤条件')
  .option('--compare <type>', '环比类型: cycle=环比(默认), yearSync=年同比', 'cycle')
  .option('--period <period>', '时间周期: 7d(默认), 30d, day, week, month', '7d')
  .action(async function(keyword, options, command) {
    const mainOpts = command && command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    const port = parseInt(options.port) || 9222;
    const maxPages = parseInt(options.pages) || 1;
      const mode = options.mode || 'hot';
      
      const { isChromeDevToolsAvailable, generateChromeLaunchCommand, ERRORS } = require('../src/sycm-browser-helper');
      const { extractSycmData, DEFAULT_FILTER_CONDITIONS, VALID_COMPARE_TYPES, VALID_PERIODS, DEFAULT_PAGE_FILTERS } = require('../src/sycm-cdp-extractor');
      
      // 解析页面级筛选参数（环比/年同比 + 时间周期）
      let userCompare = options.compare || DEFAULT_PAGE_FILTERS.compareType;
      let userPeriod = options.period || DEFAULT_PAGE_FILTERS.timePeriod;
      
      if (!VALID_COMPARE_TYPES.includes(userCompare)) {
        console.error('错误: 无效的 --compare 值 "' + userCompare + '", 有效选项: ' + VALID_COMPARE_TYPES.join(', '));
        process.exit(1);
      }
      if (!VALID_PERIODS.includes(userPeriod)) {
        console.error('错误: 无效的 --period 值 "' + userPeriod + '", 有效选项: ' + VALID_PERIODS.join(', '));
        process.exit(1);
      }
      
      // 解析过滤条件
      let filterConditions = null;
      if (mode === 'blue') {
        const userFilters = {};
        if (options.filter) {
          options.filter.split(',').forEach(function(pair) {
            const parts = pair.split('=');
            if (parts.length === 2) {
              const key = parts[0].trim();
              const val = parseFloat(parts[1].trim());
              if (!isNaN(val)) userFilters[key] = val;
            }
          });
        }
        if (options.defaultFilters !== false) {
          filterConditions = Object.assign({}, DEFAULT_FILTER_CONDITIONS, userFilters);
        } else if (Object.keys(userFilters).length > 0) {
          filterConditions = userFilters;
        }
      }
    
    try {

      // 步骤1：检测 Chrome 是否在调试模式运行
      const chromeAvailable = await isChromeDevToolsAvailable(port);
      
      if (!chromeAvailable) {
        const launchCmd = generateChromeLaunchCommand({ port });
        if (jsonMode) {
          process.stdout.write(JSON.stringify({
            ok: false,
            status: 'chrome_not_running',
            chromeLaunchCmd: launchCmd.command,
            message: ERRORS.CHROME_NOT_RUNNING.trim(),
            hint: '请先用上述命令启动 Chrome，然后重新运行此命令'
          }, null, 2) + '\n');
          return;
        } else {
          console.error('\n❌ Chrome 未运行调试模式');
          console.error('\n请先用以下命令启动 Chrome：');
          console.error(`  ${launchCmd.command}`);
          console.error('\n启动后重新运行此命令即可。');
          process.exit(1);
        }
      }

        // 步骤2：通过 CDP 直接提取数据
        const progressMsgs = [];
        const result = await extractSycmData(keyword, {
          port: port,
          maxPages: maxPages,
          mode: mode,
          filterConditions: filterConditions,
          pageFilters: { compareType: userCompare, timePeriod: userPeriod },
          onProgress: function(msg) { progressMsgs.push(msg); if (!jsonMode) console.log('  ' + msg); }
        });

       if (jsonMode) {
         process.stdout.write(JSON.stringify({
           ok: true,
           keyword: result.keyword,
           source: result.source,
           extractedAt: result.extractedAt,
           method: result.method,
           mode: result.mode,
           filterApplied: result.filterApplied,
           pageFiltersApplied: result.pageFiltersApplied,
           totalPages: result.totalPages,
           currentPage: result.currentPage,
           totalCount: result.totalCount,
           headers: result.headers,
           data: result.data
         }, null, 2) + '\n');
         return;
       }

      // 人类可读输出
      console.log('\n' + '='.repeat(100));
      console.log('\u{1f4ca} SYCM \u641c\u7d22\u5206\u6790 \u2014 ' + result.keyword + ' | \u524d' + result.maxPages + '\u9875 | 6\u5217 | \u5171 ' + result.totalCount + ' \u6761');
      console.log('-'.repeat(100));

      const displayRows = result.data.slice(0, 20);
      if (result.data.length > 20) displayRows.push({ keyword: '...' });
      const fields = ['searchPopularity', 'clickRate', 'conversionRate', 'buyerCount', 'demandSupplyRatio', 'tmallClickShare'];

      displayRows.forEach(function(row, idx) {
        let line = String(idx + 1).padStart(3) + '. ' + (row.keyword || '?').padEnd(18);
        fields.forEach(function(f) {
          var v = row[f], t = row[f + '_trend'];
          line += ' | ' + (String(v != null ? v : '-').padStart(14) + (t ? ' (' + t + ')' : ''));
        });
        console.log(line);
      });
      if (result.data.length > 20) console.log('... \u8fd8\u5176 ' + (result.data.length - 20) + ' \u6761 ...');
      console.log('-'.repeat(100));
      console.log('\u2705 \u63d0\u53d6\u5b8c\u6210\uff01 ' + result.totalCount + ' \u6761\u6570\u636e (' + result.totalPages + '\u9875)');

      if (result.categoryAnalysis && result.categoryAnalysis.data && result.categoryAnalysis.data.rows && result.categoryAnalysis.data.rows.length > 0) {
        var rec = result.categoryAnalysis.recommendation;
        console.log('\n📊 类目分析 — ' + result.keyword);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        if (rec && rec.recommended) {
          console.log('⭐ 推荐类目: ' + rec.recommended.category);
          console.log('   点击人数占比 ' + rec.recommended.clickRatio + '%，点击率 ' + rec.recommended.clickRate + '%');
          console.log('   ' + rec.reason);
          console.log('');
        }
        console.log('排名 | 类目路径' + ' '.repeat(50) + '| 点击人数占比 | 点击率');
        console.log('-----|' + '-'.repeat(58) + '|-------------|------');
        rec.ranking.forEach(function(row, idx) {
          var cat = row.category.slice(0, 55);
          var pad = 58 - cat.length;
          console.log('  ' + (idx + 1) + ' | ' + cat + ' '.repeat(pad) + '| ' + (row.clickRatio + '%').padStart(9) + ' | ' + row.clickRate + '%');
        });
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      } else {
        console.log('\n📊 类目分析: 暂无数据');
      }

    } catch (error) {
      if (jsonMode) {
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      } else {
        console.error('\n❌ 错误:', error.message);
      }
      process.exit(1);
    }
  });

program.parse();
