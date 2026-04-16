const { extractCoreAndModifiers } = require('./extract-core');
const { searchAndFilter } = require('./search-1688');
const { generateTitles } = require('./generate-title');

/**
 * 主入口：运行标题生成流程
 * @param {string} input - 用户输入关键词
 * @param {number} maxLength - 最大长度
 * @returns {Promise<{
 *   coreWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>,
 *   filteredCount: number,
 *   titles: Array<string>
 * }>} 
 */
async function run(input, maxLength = 60) {
  console.log(`🔍 正在处理: ${input}`);
  
  // 步骤 1: 提取核心词和修饰词（带刚性判断）
  console.log('📝 提取核心词和修饰词...');
  const { coreWord, modifiers } = await extractCoreAndModifiers(input);
  console.log(`  核心词: ${coreWord}`);
  console.log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);
  
  // 步骤 2: 搜索并过滤
  console.log(`🔎 在 1688 搜索 "${coreWord}" 并过滤...`);
  const products = await searchAndFilter(coreWord, modifiers);
  
  if (products.length === 0) {
    console.log('  ⚠️  没有找到匹配的商品');
    return {
      coreWord,
      modifiers,
      filteredCount: 0,
      titles: []
    };
  }
  
  console.log(`  过滤后剩余 ${products.length} 个商品`);
  
  // 步骤 3: 生成标题
  console.log('✍️  生成标题...');
  const titles = generateTitles(input, coreWord, products, modifiers, maxLength);
  
  return {
    coreWord,
    modifiers,
    filteredCount: products.length,
    titles
  };
}

module.exports = { run };
