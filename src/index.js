const { extractCoreAndModifiers } = require('./extract-core');
const { searchAndFilter } = require('./search-1688');
const { searchTaobaoTitles } = require('./search-taobao');
const { generateTitles } = require('./generate-title');

/**
 * 主入口：运行标题生成流程
 * @param {string} input - 用户输入关键词
 * @param {object} options - 配置选项
 * @param {number} [options.maxLength=60] - 最大长度
 * @param {string[]} [options.peerTitles=[]] - 手动提供的同行标题，如不提供则自动搜索
 * @returns {Promise<{
 *   coreWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>,
 *   filteredCount: number,
 *   titles: Array<string>
 * }>}
 */
async function run(input, options = {}) {
  // 从 options 解构配置，提供默认值
  const { maxLength = 60, peerTitles = [] } = options;
  console.log(`🔍 正在处理: ${input}`);
  
  // 步骤 1: 提取核心词和修饰词（带刚性判断）
  console.log('📝 提取核心词和修饰词...');
  const { coreWord, modifiers } = await extractCoreAndModifiers(input);
  console.log(`  核心词: ${coreWord}`);
  console.log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);
  
  // 步骤 2: 并行执行 1688 搜索和淘宝搜索
  console.log('🔎 并行搜索 1688 商品和淘宝同行标题...');
  const [products, taobaoTitles] = await Promise.all([
    searchAndFilter(coreWord, modifiers),
    peerTitles.length > 0
      ? Promise.resolve(peerTitles)  // 如果手动提供了同行标题，直接使用
      : searchTaobaoTitles(coreWord)   // 否则调用淘宝搜索
  ]);

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
  if (taobaoTitles.length > 0) {
    console.log(`  获取到 ${taobaoTitles.length} 个淘宝同行标题`);
  }

  // 步骤 3: 生成标题
  console.log('✍️  生成标题...');
  const titles = await generateTitles(coreWord, modifiers, taobaoTitles, products, maxLength);
  
  return {
    coreWord,
    modifiers,
    filteredCount: products.length,
    titles
  };
}

module.exports = { run };
