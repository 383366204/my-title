#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const { run } = require('../src');

const program = new Command();

program
  .name('my-title')
  .description('电商选品标题生成工具 - 关键词 → GLM提取 → 1688搜索 → 相关性过滤 → 生成淘宝标题')
  .argument('<keywords>', '用户输入关键词，如"纯银项链女高级感"')
  .option('-l, --length <number>', '标题最大长度（字符）', '60')
  .option('-c, --count <number>', '输出候选标题数量', '3')
  .action(async (keywords, options) => {
    try {
      const result = await run(keywords, parseInt(options.length));
      
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
        console.log(`${index + 1}. ${title} (${title.length} 字符)`);
      });
      
      console.log();
    } catch (error) {
      console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

program.parse();
