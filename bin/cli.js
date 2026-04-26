#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const { run } = require('../src');
const { formatResult } = require('../src/output-formatter');
const { byteLen } = require('../src/title-utils');
const fs = require('fs');
const path = require('path');

const program = new Command();

program
  .name('my-title')
  .description('电商选品标题生成工具 - 关键词 → GLM提取 → 1688搜索 → 相关性过滤 → 生成淘宝标题（可参考淘宝同行标题）')
  .argument('<keywords>', '用户输入关键词，如"纯银项链女高级感"')
  .option('-l, --length <number>', '标题最大长度（字符，1汉字=2字符）', '60')
  .option('-c, --count <number>', '输出候选标题数量', '3')
  .option('-p, --peer-titles <titles>', '手动提供淘宝同行标题，逗号分隔')
  .option('-f, --peer-titles-file <path>', '从文件读取淘宝同行标题，每行一个')
  .option('--json', '纯 JSON 输出模式，抑制所有进度信息，适合程序调用')
  .option('--format <type>', '输出格式: table / json / both', 'both')
  .option('--research', '分析并推荐去生意参谋查哪些关键词')
  .option('--keyword-file <path>', '加载生意参谋搜索分析数据文件')
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
      // --research 模式：只分析并推荐关键词
      if (options.research) {
        const result = await run(keywords, {
          maxLength: parseInt(options.length),
          peerTitles: [],
          silent: jsonMode,
          limit: 0,
          research: true
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
        sycmData
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

program.parse();
