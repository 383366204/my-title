#!/usr/bin/env node

require('../core/env').loadEnv();
const { Command } = require('commander');
const { batchRun, generateTitlePipeline } = require('../skills/title-gen');
const { searchAll } = require('../skills/alibaba1688');
const { formatResult } = require('../skills/title-gen/src/output-formatter');
const { byteLen } = require('../skills/title-gen/src/title-utils');
const fs = require('fs');
const path = require('path');

const searchProductsAdapter = ({ coreWord, blueOceanWord, modifiers, semanticGroups }) =>
  searchAll(coreWord, blueOceanWord, modifiers, semanticGroups);

function stringifyAsciiJson(value, spaces = 2) {
  return JSON.stringify(value, null, spaces).replace(/[^\x00-\x7F]/g, ch => {
    const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}

function writeAsciiJson(value) {
  process.stdout.write(stringifyAsciiJson(value, 2) + '\n');
}

async function fetchSycmKeywordDataAdapter({ keyword }) {
  const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../skills/sycm-research');
  const result = await extractSycmData(keyword, {
    port: parseInt(process.env.SYCM_DEBUG_PORT || '9222', 10),
    maxPages: parseInt(process.env.SYCM_MAX_PAGES || '1', 10),
    mode: process.env.SYCM_TITLE_MODE || 'blue',
    loginMode: process.env.SYCM_LOGIN_MODE || 'manual',
    filterConditions: DEFAULT_FILTER_CONDITIONS
  });
  return result && Array.isArray(result.data) ? result.data : [];
}

const program = new Command();

program
  .name('ecom-ai-tools')
  .description('电商选品AI工具箱 - 关键词 → GLM提取 → 1688搜索 → 相关性过滤 → 生成淘宝标题（可参考淘宝同行标题）')
  .argument('[keywords]', '用户输入关键词，如"纯银项链女高级感"')
  .option('-l, --length <number>', '标题最大长度（字符，1汉字=2字符）', '60')
  .option('-c, --count <number>', '输出候选标题数量（0=全部）', '0')
  .option('-p, --peer-titles <titles>', '手动提供淘宝同行标题，逗号分隔')
  .option('-f, --peer-titles-file <path>', '从文件读取淘宝同行标题，每行一个')
  .option('--json', '纯 JSON 输出模式，抑制所有进度信息，适合程序调用')
  .option('--format <type>', '输出格式: table / json / both', 'both')
  .option('--research', '分析并推荐去生意参谋查哪些关键词')
  .option('--sycm-auto', '自动查询生意参谋蓝海数据（需要Chrome在调试模式运行）')
  .option('--keyword-file <path>', '加载生意参谋搜索分析数据文件')
  .option('--keywords <keywords>', '批量关键词模式（逗号分隔，如 "纯银项链女,925银手链"）')
  .option('--suggest', '自动选词模式：GLM推荐候选词 → 输出蓝海词列表')
  .option('--strategy <type>', '选词策略：crowd(人群) | scene(场景) | season(季节) | problem(痛点) | industry(行业)', 'season')
  .option('--input <text>', '策略输入（人群/场景/痛点/行业描述，season策略可省略）')
  .option('--max-candidates <number>', 'GLM最大候选词数量', '5')
  .option('--sycm-verify', '启用生意参谋 SYCM 验证（默认关闭）')
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
          searchProducts: searchProductsAdapter,
          fetchKeywordData: options.sycmAuto ? fetchSycmKeywordDataAdapter : undefined,
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
        const { suggestAndVerify, VALID_STRATEGIES } = require('../skills/title-gen');
        
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
          skipSycm: !options.sycmVerify,
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
        const result = await generateTitlePipeline(keywords, {
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

      const result = await generateTitlePipeline(keywords, {
        maxLength: parseInt(options.length),
        peerTitles,
        silent: jsonMode,
        limit: parseInt(options.count),
        sycmData,
        sycmAuto: options.sycmAuto,
        searchProducts: searchProductsAdapter,
        fetchKeywordData: options.sycmAuto ? fetchSycmKeywordDataAdapter : undefined
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
      const { fetchOpportunities } = require('../skills/alibaba1688');
        return fetchOpportunities().then(function(result) {
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
      const { fetchTrend } = require('../skills/alibaba1688');
      const result = await fetchTrend(query);

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
  .command('search-1688-web-health')
  .description('Check Chrome CDP and current 1688 web-search page readiness')
  .option('--port <number>', 'Chrome remote debugging port', process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || '9222')
  .option('--json', 'Output JSON only')
  .action(async function(options, command) {
    const mainOpts = command && command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { checkWeb1688Status } = require('../skills/alibaba1688');
      const result = await checkWeb1688Status({
        port: parseInt(options.port, 10) || 9222
      });
      if (jsonMode) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }
      console.log('\n1688 web health');
      console.log('='.repeat(50));
      console.log('ok: ' + result.ok);
      console.log('cdp: ' + (result.cdp && result.cdp.ok ? 'ok' : 'blocked') + ' port=' + (result.cdp && result.cdp.port || ''));
      if (result.page) {
        console.log('page: ' + result.page.url);
        console.log('cards: ' + result.page.productCardCount);
        console.log('login: ' + result.page.hasLoginText + ' captcha: ' + result.page.hasCaptchaText);
      }
      if (result.diagnostics && result.diagnostics.warnings && result.diagnostics.warnings.length) {
        console.log('warnings: ' + result.diagnostics.warnings.join(', '));
      }
      if (result.message) console.log(result.message);
    } catch (error) {
      if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, error: error.message }, null, 2) + '\n');
      else console.error('\nError:', error.message);
      process.exit(1);
    }
  });

program
  .command('search-1688-web <keyword>')
  .description('Search 1688 web page through an existing Chrome CDP session')
  .option('--port <number>', 'Chrome remote debugging port', process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || '9222')
  .option('--max-products <number>', 'Maximum products to return', '20')
  .option('--max-pages <number>', 'Maximum 1688 search pages to collect when max-products is large')
  .option('--max-resolve-links <number>', 'Maximum redirect links to resolve', '8')
  .option('--no-scroll-load', 'Disable scroll-based lazy loading before extraction')
  .option('--scroll-steps <number>', 'Maximum scroll steps for lazy-loaded 1688 cards', '8')
  .option('--min-price <number>', 'Minimum product price')
  .option('--max-price <number>', 'Maximum product price')
  .option('--min-sales30d <number>', 'Minimum 30-day sales')
  .option('--sort <type>', 'Page sort: sales or price')
  .option('--min-order-quantity <number>', 'Minimum order quantity page filter')
  .option('--max-order-quantity <number>', 'Maximum order quantity page filter')
  .option('--min-shop-products <number>', 'Minimum shop product count page filter')
  .option('--page-feature <words>', '1688 page feature filters to click, comma separated, such as one-piece dropship or 48H delivery')
  .option('--include <words>', 'Required title keywords, comma separated')
  .option('--exclude <words>', 'Excluded title keywords, comma separated')
  .option('--json', 'Output JSON only')
  .action(async function(keyword, options, command) {
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
      const { searchWeb1688 } = require('../skills/alibaba1688');
      const result = await searchWeb1688({
        keyword,
        port: parseInt(options.port, 10) || 9222,
        maxProducts: parseInt(options.maxProducts, 10) || 20,
        maxPages: options.maxPages === undefined ? undefined : parseInt(options.maxPages, 10),
        maxResolveLinks: parseInt(options.maxResolveLinks, 10) || 8,
        scrollLoad: options.scrollLoad !== false,
        scrollSteps: parseInt(options.scrollSteps, 10) || 8,
        minPrice: options.minPrice === undefined ? undefined : Number(options.minPrice),
        maxPrice: options.maxPrice === undefined ? undefined : Number(options.maxPrice),
        minSales30d: options.minSales30d === undefined ? undefined : Number(options.minSales30d),
        pageSort: options.sort,
        minOrderQuantity: options.minOrderQuantity === undefined ? undefined : Number(options.minOrderQuantity),
        maxOrderQuantity: options.maxOrderQuantity === undefined ? undefined : Number(options.maxOrderQuantity),
        minShopProducts: options.minShopProducts === undefined ? undefined : Number(options.minShopProducts),
        pageFeatureKeywords: options.pageFeature ? options.pageFeature.split(',').map(s => s.trim()).filter(Boolean) : [],
        includeKeywords: options.include ? options.include.split(',').map(s => s.trim()).filter(Boolean) : [],
        excludeKeywords: options.exclude ? options.exclude.split(',').map(s => s.trim()).filter(Boolean) : []
      });

      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }

      console.log('\n1688 web search: ' + keyword);
      console.log('='.repeat(50));
      console.log('page: ' + (result.meta && result.meta.pageUrl || ''));
      console.log('raw cards: ' + (result.meta && result.meta.rawCards || 0));
      if (result.meta && result.meta.priceBand && result.meta.priceBand.display) {
        console.log('price band: ' + result.meta.priceBand.display);
      }
      if (result.meta && result.meta.pageFiltersApplied && result.meta.pageFiltersApplied.applied) {
        console.log('page filters: ' + result.meta.pageFiltersApplied.actions.join(', '));
      }
      if (result.meta && result.meta.scrollLoad && result.meta.scrollLoad.enabled) {
        console.log('scroll load: ' + result.meta.scrollLoad.finalCount + ' cards, ' + result.meta.scrollLoad.steps + ' steps, ' + result.meta.scrollLoad.reason);
      }
      if (result.meta && result.meta.diagnostics) {
        const diag = result.meta.diagnostics;
        console.log('diagnostics: extracted=' + diag.extractedCards + ' final=' + diag.finalProducts + ' validOfferIds=' + diag.validOfferIds);
        if (diag.warnings && diag.warnings.length) console.log('warnings: ' + diag.warnings.join(', '));
      }
      console.log('products: ' + result.products.length);
      result.products.forEach((product, index) => {
        console.log((index + 1) + '. ' + (product.title || product.subject || ''));
        console.log('   ' + (product.url || product.redirectUrl || ''));
        console.log('   price=' + (product.price || '') + ' priceBand=' + (product.priceBand && product.priceBand.display || '') + ' sales30d=' + (product.sales30days || 0) + ' shop=' + (product.shopName || ''));
      });
    } catch (error) {
      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      } else {
        console.error('\nError:', error.message);
      }
      process.exit(1);
    }
  });

program
  .command('seed')
  .description('管理每日蓝海选词种子池')
  .command('list')
  .description('查看当前种子池')
  .option('--json', '纯 JSON 输出模式')
  .option('--all', '包含 paused 状态的种子')
  .action(function(options, command) {
    const mainOpts = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { listSeeds } = require('../skills/keyword-mining');
      const seeds = listSeeds({ includePaused: !!options.all });
      if (jsonMode) {
        writeAsciiJson({ ok: true, seeds });
        return;
      }
      console.log('\n🌱 当前种子池');
      console.log('='.repeat(80));
      seeds.forEach((seed, idx) => {
        console.log(`${idx + 1}. ${seed.keyword} | ${seed.category || '-'} | priority=${seed.priority} | score=${seed.priorityScore} | ${seed.source || '-'}`);
        if (seed.reason) console.log(`   ${seed.reason}`);
      });
      console.log();
    } catch (error) {
      if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, error: error.message }, null, 2) + '\n');
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

program
  .command('seed-add <keyword>')
  .description('添加一个蓝海选词种子')
  .option('--category <category>', '种子类目', '')
  .option('--priority <number>', '基础优先级', '5')
  .option('--source <source>', '来源', 'manual')
  .option('--reason <reason>', '添加原因', '')
  .option('--json', '纯 JSON 输出模式')
  .action(function(keyword, options, command) {
    const mainOpts = command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { addSeed } = require('../skills/keyword-mining');
      const seed = addSeed(keyword, {
        category: options.category,
        priority: parseInt(options.priority, 10) || 5,
        source: options.source,
        reason: options.reason
      });
      if (jsonMode) {
        writeAsciiJson({ ok: true, seed });
        return;
      }
      console.log(`\n✅ 已加入种子池: ${seed.keyword}`);
      console.log(`类目: ${seed.category || '-'} | 优先级: ${seed.priority} | 来源: ${seed.source}`);
      if (seed.reason) console.log(`原因: ${seed.reason}`);
      console.log();
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

program.commands.find(cmd => cmd.name() === 'seed')
  .command('add <keyword>')
  .description('添加一个蓝海选词种子')
  .option('--category <category>', '种子类目', '')
  .option('--priority <number>', '基础优先级', '5')
  .option('--source <source>', '来源', 'manual')
  .option('--reason <reason>', '添加原因', '')
  .option('--json', '纯 JSON 输出模式')
  .action(function(keyword, options, command) {
    const root = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!root.json;
    try {
      const { addSeed } = require('../skills/keyword-mining');
      const seed = addSeed(keyword, {
        category: options.category,
        priority: parseInt(options.priority, 10) || 5,
        source: options.source,
        reason: options.reason
      });
      if (jsonMode) {
        writeAsciiJson({ ok: true, seed });
        return;
      }
      console.log(`\n✅ 已加入种子池: ${seed.keyword}`);
      console.log(`类目: ${seed.category || '-'} | 优先级: ${seed.priority} | 来源: ${seed.source}`);
      if (seed.reason) console.log(`原因: ${seed.reason}`);
      console.log();
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

program
  .command('mine-keywords')
  .description('从种子词池挖掘每日候选蓝海词')
  .option('--limit <number>', '输出候选词数量', '50')
  .option('--count <number>', '输出候选词数量（兼容旧参数，建议使用 --limit）')
  .option('--max-seeds <number>', '本次使用的最大种子数量', '20')
  .option('--max-per-seed <number>', '每个种子的最大扩词数量', '30')
  .option('--output-max-per-seed <number>', '输出结果中每个种子的最大候选数量', '5')
  .option('--output-max-per-category <number>', '输出结果中每个类目的最大候选数量', '20')
  .option('--output-max-per-pattern <number>', '输出结果中每种扩词模式的最大候选数量', '20')
  .option('--output-max-per-product-core <number>', '输出结果中每个商品核心词的最大候选数量', '3')
  .option('--no-persist', '不写入 data/keyword-mining/candidates.jsonl')
  .option('--sycm-precheck', '启用SYCM预检过滤（查询搜索人气，低于阈值的词直接丢弃）')
  .option('--min-popularity <number>', 'SYCM搜索人气最低阈值', '50')
  .option('--mode <mode>', '本地筛选强度: strict / balanced / explore', 'balanced')
  .option('--include-direct-seeds', '把 direct 类型种子也混入候选词输出（默认只单独提示，不参与挖词排序）')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(options, command) {
    const mainOpts = command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { mineKeywords } = require('../skills/keyword-mining');
      const outputLimit = parseInt(options.limit || options.count, 10) || 50;
      const result = await mineKeywords({
        count: outputLimit,
        maxSeeds: parseInt(options.maxSeeds, 10) || 20,
        maxPerSeed: parseInt(options.maxPerSeed, 10) || 30,
        outputMaxPerSeed: parseInt(options.outputMaxPerSeed, 10) || 5,
        outputMaxPerCategory: parseInt(options.outputMaxPerCategory, 10) || 20,
        outputMaxPerPattern: parseInt(options.outputMaxPerPattern, 10) || 20,
        outputMaxPerProductCore: parseInt(options.outputMaxPerProductCore, 10) || 3,
        persist: options.persist !== false,
        sycmPrecheck: !!options.sycmPrecheck,
        minSearchPopularity: parseInt(options.minPopularity, 10) || 50,
        includeDirect: !!options.includeDirectSeeds,
        mode: options.mode || 'balanced'
      });
      if (jsonMode) {
        writeAsciiJson(result);
        return;
      }
      console.log('\n🔎 今日候选蓝海词');
      console.log(`日期: ${result.date} | 使用种子: ${result.seedsUsed} | 候选: ${result.candidates.length}`);
      if (result.stats) {
        console.log(`扩词: ${result.stats.expanded} | 聚类: ${result.stats.clustered} | 去重: ${result.stats.duplicatesRemoved} | 阈值: ${result.stats.threshold} | 高/中/低: ${result.stats.high}/${result.stats.mid}/${result.stats.low}`);
      }
      if (result.directKeywords && result.directKeywords.length) {
        console.log(`Direct种子: ${result.directKeywords.length} 个（已足够具体，建议直接选品或先 hot/blue 双验证）`);
      }
      console.log('='.repeat(90));
      result.candidates.forEach((item, idx) => {
        console.log(`${idx + 1}. ${item.keyword} | ${item.tier} | 分数 ${item.localScore} | core=${item.coreProduct || '-'} | seed=${item.seed} | ${item.pattern} | ${item.nextAction}`);
        console.log(`   ${item.reason}`);
        if (item.clusterSize > 1) console.log(`   同方向合并: ${item.clusterSize} 个，代表词: ${item.cluster.slice(0, 5).join(' / ')}`);
        if (item.nextCommands && item.nextCommands.hotCheck) console.log(`   热搜验证: ${item.nextCommands.hotCheck}`);
        if (item.nextCommands && item.nextCommands.blueExplore) console.log(`   蓝海深挖: ${item.nextCommands.blueExplore}`);
      });
      console.log('\n下一步：先用 hot 确认有人搜，再用 blue 从入口词深挖高 DSR 蓝海关联词。');
      console.log();
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

const flowCommand = program
  .command('flow')
  .description('每日蓝海选品流水线：选词 → 生意参谋校验 → 标题生成 → 导出铺货清单');

flowCommand
  .command('daily')
  .description('执行第一版每日流水线，不自动铺货')
  .option('--mine <number>', '候选词数量', '50')
  .option('--verify <number>', '生意参谋校验数量', '20')
  .option('--generate <number>', '标题生成关键词数量', '10')
  .option('--export <number>', '导出铺货商品数量', '20')
  .option('--products-per-keyword <number>', '每个关键词最多导出商品数', '3')
  .option('--length <number>', '标题最大长度', '60')
  .option('--port <number>', 'Chrome 调试端口', '9222')
  .option('--pages <number>', '生意参谋最大提取页数', '1')
  .option('--min-blue-rows <number>', '蓝海词少于该数量时降级查热搜词', '1')
  .option('--no-hot-fallback', '蓝海词不足时不降级查热搜词')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(options, command) {
    const mainOpts = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { flowDaily } = require('../skills/pipeline-flow');
      const result = await flowDaily({
        mine: parseInt(options.mine, 10) || 50,
        verify: parseInt(options.verify, 10) || 20,
        generate: parseInt(options.generate, 10) || 10,
        export: parseInt(options.export, 10) || 20,
        productsPerKeyword: parseInt(options.productsPerKeyword, 10) || 3,
        length: parseInt(options.length, 10) || 60,
        port: parseInt(options.port, 10) || 9222,
        pages: parseInt(options.pages, 10) || 1,
        minBlueRows: parseInt(options.minBlueRows, 10) || 1,
        fallbackHot: options.hotFallback !== false
      });
      if (jsonMode) {
        writeAsciiJson(result);
        return;
      }
      console.log('\n✅ 每日流水线完成');
      console.log(`Run: ${result.runId}`);
      console.log(`状态: ${result.status}`);
      console.log(`候选 ${result.steps.mined} | 验证通过 ${result.steps.verified} | 拒绝 ${result.steps.rejected} | 生成商品 ${result.steps.generated} | 导出 ${result.steps.exported}`);
      console.log(`铺货清单: ${result.files.distributionBatch}`);
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

flowCommand
  .command('mine')
  .description('只执行候选词生成并创建 run')
  .option('--limit <number>', '候选词数量', '50')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(options, command) {
    const mainOpts = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { flowMine } = require('../skills/pipeline-flow');
      const result = await flowMine({ limit: parseInt(options.limit, 10) || 50 });
      if (jsonMode) {
        writeAsciiJson({ ok: true, runId: result.runId, status: result.status, runDir: result.runDir, candidates: result.candidates.length, nextCommand: result.nextCommand });
        return;
      }
      console.log(`✅ 已生成候选词: ${result.candidates.length}`);
      console.log(`Run: ${result.runId}`);
      console.log(`Next: ${result.nextCommand}`);
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

flowCommand
  .command('verify')
  .description('串行执行生意参谋校验')
  .option('--run <id>', '指定 runId，默认 latest')
  .option('--limit <number>', '校验数量', '20')
  .option('--port <number>', 'Chrome 调试端口', '9222')
  .option('--pages <number>', '生意参谋最大提取页数', '1')
  .option('--min-blue-rows <number>', '蓝海词少于该数量时降级查热搜词', '1')
  .option('--no-hot-fallback', '蓝海词不足时不降级查热搜词')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(options, command) {
    const mainOpts = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { flowVerify } = require('../skills/pipeline-flow');
      const result = await flowVerify({
        runId: options.run,
        limit: parseInt(options.limit, 10) || 20,
        port: parseInt(options.port, 10) || 9222,
        pages: parseInt(options.pages, 10) || 1,
        minBlueRows: parseInt(options.minBlueRows, 10) || 1,
        fallbackHot: options.hotFallback !== false
      });
      if (jsonMode) {
        writeAsciiJson({ ok: true, runId: result.runId, status: result.status, verified: result.verified.length, rejected: result.rejected.length, nextCommand: result.nextCommand });
        return;
      }
      console.log(`✅ 生意参谋校验完成: 通过 ${result.verified.length}，拒绝 ${result.rejected.length}`);
      console.log(`Run: ${result.runId}`);
      console.log(`Next: ${result.nextCommand}`);
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

flowCommand
  .command('generate')
  .description('对验证通过词执行 1688 选品和标题生成')
  .option('--run <id>', '指定 runId，默认 latest')
  .option('--limit <number>', '生成关键词数量', '10')
  .option('--products-per-keyword <number>', '每个关键词最多导出商品数', '3')
  .option('--length <number>', '标题最大长度', '60')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(options, command) {
    const mainOpts = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { flowGenerate } = require('../skills/pipeline-flow');
      const result = await flowGenerate({
        runId: options.run,
        limit: parseInt(options.limit, 10) || 10,
        productsPerKeyword: parseInt(options.productsPerKeyword, 10) || 3,
        length: parseInt(options.length, 10) || 60
      });
      const generated = result.generated.filter(row => row.status === 'generated').length;
      if (jsonMode) {
        writeAsciiJson({ ok: true, runId: result.runId, status: result.status, generated, nextCommand: result.nextCommand });
        return;
      }
      console.log(`✅ 标题生成完成: 商品 ${generated}`);
      console.log(`Run: ${result.runId}`);
      console.log(`Next: ${result.nextCommand}`);
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

flowCommand
  .command('export')
  .description('导出待铺货清单')
  .option('--run <id>', '指定 runId，默认 latest')
  .option('--limit <number>', '导出商品数量', '20')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(options, command) {
    const mainOpts = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { flowExport } = require('../skills/pipeline-flow');
      const result = await flowExport({
        runId: options.run,
        limit: parseInt(options.limit, 10) || 20
      });
      if (jsonMode) {
        writeAsciiJson(result);
        return;
      }
      console.log(`✅ 已导出铺货清单: ${result.count}`);
      console.log(result.file);
      console.log(`Next: ${result.nextCommand}`);
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

flowCommand
  .command('opportunities')
  .description('Inspect accumulated keyword/product opportunity pool')
  .option('--limit <number>', 'Max rows per section', '10')
  .option('--data-dir <path>', 'Pipeline data dir', 'data/pipeline')
  .option('--json', 'JSON output')
  .action(async function(options, command) {
    const mainOpts = command.parent && command.parent.parent ? command.parent.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const path = require('path');
      const { summarizeOpportunities } = require('../skills/pipeline-flow');
      const dataDir = path.join(options.dataDir || 'data/pipeline', 'opportunities');
      const result = summarizeOpportunities({ dataDir, limit: parseInt(options.limit, 10) || 10 });
      if (jsonMode) {
        writeAsciiJson(result);
        return;
      }
      console.log(`Opportunity pool: ${result.dir}`);
      console.log(`Keywords: ${result.counts.keywords} | Products: ${result.counts.products} | Rejected: ${result.counts.rejected}`);
      console.log('\nTop Keywords');
      result.topKeywords.forEach((item, index) => {
        console.log(`${index + 1}. ${item.keyword} | score=${item.opportunityScore || 0} | ${item.decision || '-'} | ${item.nextAction || '-'}`);
      });
      console.log('\nTop Products');
      result.topProducts.forEach((item, index) => {
        console.log(`${index + 1}. ${item.keyword} | score=${item.opportunityScore || 0} | ${item.level || '-'} | ${item.url || '-'}`);
      });
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\nError:', error.message);
      process.exit(1);
    }
  });

program
  .command('distribute')
  .description('Run 1688 multi-store distribution through an existing Chrome CDP session')
  .option('--input <text>', 'Distribution lines: URL, URL<TAB>title, URL<TAB>title<TAB>category, URL||title, URL||title||category, or URL$$title$$category')
  .option('--input-file <path>', 'Read distribution lines from a UTF-8 file')
  .option('--batch-size <number>', 'Products per submit batch', '20')
  .option('--port <number>', 'Chrome remote debugging port', process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || '9222')
  .option('--state-file <path>', 'JSONL file used for duplicate-submit protection')
  .option('--check', 'Check input, duplicate state, and Chrome CDP without submitting')
  .option('--dry-run', 'Parse and validate input without touching the browser')
  .option('--force', 'Allow submitting a batch that was recently submitted')
  .option('--json', 'JSON output')
  .action(async function(options, command) {
    const commandObj = command || (options && typeof options.opts === 'function' ? options : null);
    options = options && typeof options.opts === 'function' ? options.opts() : options;
    const mainOpts = commandObj && commandObj.parent ? commandObj.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { checkDistributionReadiness, distributeProducts } = require('../skills/1688-distribution');
      const inputText = options.input || mainOpts.input;
      if (!inputText && !options.inputFile) {
        throw new Error('Provide --input or --input-file');
      }
      const payload = {
        input: inputText,
        inputFile: options.inputFile,
        batchSize: parseInt(options.batchSize, 10) || 20,
        port: parseInt(options.port, 10) || 9222,
        stateFile: options.stateFile,
        dryRun: !!options.dryRun,
        force: !!options.force
      };
      const result = options.check
        ? await checkDistributionReadiness(payload)
        : await distributeProducts(payload);
      if (jsonMode) {
        writeAsciiJson(result);
        return;
      }
      console.log('Distribution result:');
      console.log(`  total: ${result.total}`);
      if (result.status) console.log(`  status: ${result.status}`);
      if (result.blockers && result.blockers.length) console.log(`  blockers: ${result.blockers.join(', ')}`);
      if (result.browser) console.log(`  browser: ${result.browser.ok ? 'ok' : 'blocked'} (${result.browser.message || ''})`);
      result.batches.forEach(batch => {
        const status = batch.duplicate ? 'duplicate' : (batch.skipped ? `skipped:${batch.reason}` : (batch.ok ? 'ok' : 'ready'));
        console.log(`  batch ${batch.batchIndex}: ${status}, count=${batch.count || 0}, hash=${batch.batchHash}`);
        if (batch.logUrl) console.log(`    log: ${batch.logUrl}`);
      });
      if (result.nextAction) console.log(`Next: ${result.nextAction}`);
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\nError:', error.message);
      process.exit(1);
    }
  });

program
  .command('sync-hermes-skills')
  .description('Copy project skills into Hermes trusted skill directory as real files')
  .option('--target <dir>', 'Hermes ecommerce skills directory')
  .option('--mode <copy|wrapper>', 'Sync mode: copy copies full skill; wrapper writes a small live-project wrapper', 'copy')
  .option('--project-root <path>', 'Project root path written into wrapper mode')
  .option('--skill <name>', 'Skill name to sync; can be repeated', (value, previous) => {
    previous.push(value);
    return previous;
  }, [])
  .option('--apply', 'Actually replace the target; default is dry-run')
  .option('--json', 'JSON output')
  .action(async function(options, command) {
    const commandObj = command || (options && typeof options.opts === 'function' ? options : null);
    options = options && typeof options.opts === 'function' ? options.opts() : options;
    const mainOpts = commandObj && commandObj.parent ? commandObj.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    try {
      const { syncSkill, defaultHermesSkillsDir } = require('../scripts/sync-hermes-skills');
      const targetRoot = options.target || defaultHermesSkillsDir();
      const skills = options.skill.length > 0 ? options.skill : ['1688-distribution', 'keyword-mining', 'pipeline-flow'];
      const results = skills.map(skillName => syncSkill(skillName, {
        targetRoot,
        dryRun: !options.apply,
        mode: options.mode || 'copy',
        projectRoot: options.projectRoot
      }));
      const payload = {
        ok: true,
        dryRun: !options.apply,
        targetRoot,
        results
      };
      if (jsonMode) {
        writeAsciiJson(payload);
        return;
      }
      console.log(`${payload.dryRun ? 'Dry run' : 'Synced'} Hermes skills (${options.mode || 'copy'}):`);
      payload.results.forEach(row => {
        console.log(`  ${row.skillName}: ${row.action}${row.wasSymlink ? ' (replacing symlink)' : ''}`);
        console.log(`    ${row.source}`);
        console.log(`    -> ${row.target}`);
      });
    } catch (error) {
      if (jsonMode) writeAsciiJson({ ok: false, error: error.message });
      else console.error('\nError:', error.message);
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
  .option('--login-mode <mode>', '登录模式: manual(默认，复用人工登录态；不再自动登录)', process.env.SYCM_LOGIN_MODE || 'manual')
  .option('--chrome-profile-dir <path>', 'Chrome 登录态目录（默认读取 SYCM_CHROME_PROFILE_DIR）')
  .option('--username <username>', '已废弃：不再自动输入账号')
  .option('--password <password>', '已废弃：不再自动输入密码')
  .option('--phone <phone>', '已废弃：不再自动发送验证码')
  .option('--sms-code <code>', '已废弃：不再自动提交验证码')
  .action(async function(keyword, options, command) {
    const mainOpts = command && command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    const port = parseInt(options.port) || 9222;
    const maxPages = parseInt(options.pages) || 1;
    const mode = options.mode || 'blue';
    
    const { isChromeDevToolsAvailable, autoLaunchChrome, extractSycmData, DEFAULT_FILTER_CONDITIONS, VALID_COMPARE_TYPES, VALID_PERIODS, DEFAULT_PAGE_FILTERS } = require('../skills/sycm-research');

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
    if (!['manual'].includes(String(options.loginMode || '').toLowerCase())) {
      console.error('错误: 无效的 --login-mode 值 "' + options.loginMode + '", 当前仅支持 manual');
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

    if (!await isChromeDevToolsAvailable(port)) {
      console.error('⏳ Chrome 未运行，正在自动启动...');
      const launchResult = await autoLaunchChrome(port, { userDataDir: options.chromeProfileDir });
      if (!launchResult.success) {
        if (jsonMode) {
          process.stdout.write(JSON.stringify({
            ok: false,
            status: 'chrome_launch_failed',
            message: launchResult.message,
          }, null, 2) + '\n');
          return;
        } else {
          console.error('\n❌ ' + launchResult.message);
          process.exit(1);
        }
      }
      console.error('✅ ' + launchResult.message);
    }

    try {
      const progressMsgs = [];
      const result = await extractSycmData(keyword, {
        port: port,
        maxPages: maxPages,
        mode: mode,
        loginMode: String(options.loginMode || 'manual').toLowerCase(),
        chromeProfileDir: options.chromeProfileDir,
        username: options.username,
        password: options.password,
        phone: options.phone,
        smsCode: options.smsCode,
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
      if (error && error.status === 'login_required') {
        const payload = error.details || {
          ok: false,
          status: 'login_required',
          message: error.message,
          loginUrl: error.loginUrl,
          profileDir: error.profileDir
        };
        if (jsonMode) {
          process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        } else {
          console.error('\n🔐 ' + payload.message);
          console.error('请用当前 Chrome profile 人工登录: ' + payload.loginUrl);
          console.error('Profile: ' + payload.profileDir);
        }
        process.exit(1);
      }
      if (jsonMode) {
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      } else {
        console.error('\n❌ 错误:', error.message);
      }
      process.exit(1);
    }
  });

program
  .command('reverse-mine <keyword>')
  .description('从已验证关键词反向挖掘 sycm 关联词作为新种子')
  .option('--top-n <number>', '取 topN 条关联词', '10')
  .option('--min-popularity <number>', '最低搜索人气过滤', '100')
  .option('--no-auto-add', '不自动添加种子到种子池')
  .option('--max-new-seeds <number>', '最多自动添加的新种子数', '3')
  .option('--json', '纯 JSON 输出模式')
  .action(async function(keyword, options, command) {
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
      const { reverseMine } = require('../skills/keyword-mining');
      const result = await reverseMine(keyword, {
        topN: parseInt(options.topN, 10) || 10,
        minSearchPopularity: parseInt(options.minPopularity, 10) || 100,
        autoAddSeeds: options.autoAdd !== false,
        maxNewSeeds: parseInt(options.maxNewSeeds, 10) || 3
      });

      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        writeAsciiJson(result);
        return;
      }

      // 人类可读输出
      console.log('\n' + '='.repeat(80));
      console.log('\u{1f50d} 反向挖掘结果 \u2014 来源词: ' + result.sourceKeyword + ' | sycm共 ' + (result.totalCount || '-') + ' 条');
      console.log('-'.repeat(80));

      if (!result.ok) {
        console.error('\u274c ' + (result.error || '未知错误'));
        process.exit(1);
        return;
      }

      if (result.relatedWords.length === 0) {
        console.log('未找到符合条件的关联词（搜索人气 >= ' + (options.minPopularity || 100) + '）');
        console.log();
        return;
      }

      result.relatedWords.forEach((item, idx) => {
        const tag = item.promising ? '\u{1f3af}' : '  ';
        const seedTag = item.addedAsSeed ? ' \u{1f33f}\u5df2\u52a0\u79cd\u5b50' : '';
        console.log(
          String(idx + 1).padStart(2) + '. ' + tag + ' ' +
          (item.keyword || '?').padEnd(20) +
          ' | \u641c\u7d22\u4eba\u6c14:' + String(item.searchPopularity).padStart(8) +
          ' | \u9700\u6c42\u4f9b\u7ed9\u6bd4:' + String(item.demandSupplyRatio).padStart(6) +
          ' | \u8f6c\u5316\u7387:' + ((item.conversionRate * 100).toFixed(1) + '%').padStart(8) +
          ' | \u5206\u6570:' + String(item.score).padStart(3) +
          seedTag
        );
        console.log('     ' + item.reason + ' \u2192 ' + item.nextAction);
      });

      console.log('-'.repeat(80));
      console.log(
        '\u603b\u8ba1: ' + result.relatedWords.length + ' \u6761\u5173\u8054\u8bcd | ' +
        '\u63a8\u8350(promising\u226565): ' + result.relatedWords.filter(w => w.promising).length + ' \u6761 | ' +
        '\u65b0\u589e\u79cd\u5b50: ' + result.newSeedsAdded + ' \u4e2a'
      );
      console.log();
    } catch (error) {
      if (jsonMode) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }, null, 2) + '\n');
      } else {
        console.error('\n\u274c \u9519\u8bef:', error.message);
      }
      process.exit(1);
    }
  });

program.parse();
