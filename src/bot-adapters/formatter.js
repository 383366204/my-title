function formatAsText(result) {
  const lines = [
    `📝 核心词: ${result.coreWord} | 蓝海词: ${result.blueOceanWord}`,
    `📊 找到 ${result.filteredCount} 个商品`,
    ''
  ];
  (result.products || []).slice(0, 5).forEach((p, i) => {
    lines.push(`${i+1}. ${p['铺货标题'] || p.title || '无标题'}`);
    lines.push(`   💰 ${p['商品原价'] ? p['商品原价']+'元' : '无价格'} → ${p['定价建议'] || '参考定价'}`);
    lines.push(`   📈 30天销量: ${p['30天销量'] || 0} | 好评率: ${p['好评率'] || 0}%`);
    lines.push(`   ✅ ${p['选品理由'] || ''}`);
    lines.push(`   🔗 ${p['产品链接'] || ''}`);
    lines.push('');
  });
  return lines.join('\n');
}

function formatAsFeishuCard(result) {
  // Build interactive card JSON for Feishu
  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: `**核心词:** ${result.coreWord} | **找到:** ${result.filteredCount} 个商品` } }
  ];
  (result.products || []).slice(0, 5).forEach((p, i) => {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${i+1}.** ${p['铺货标题'] || '无标题'}` } });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `💰 ${p['商品原价'] || '?'}元 → ${p['定价建议'] || ''} | 📈 销量${p['30天销量'] || 0}` } });
    if (p['产品链接']) {
      elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看商品' }, type: 'primary', url: p['产品链接'] }] });
    }
    elements.push({ tag: 'hr' });
  });
  return { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: '标题生成结果' }, template: 'blue' }, elements };
}

function formatAsDingtalkCard(result) {
  // ActionCard format
  const btns = (result.products || []).slice(0, 5).map((p, i) => ({
    title: `${i+1}. ${p['铺货标题']?.substring(0,20) || '商品'}`,
    actionURL: p['产品链接'] || '#'
  }));
  const text = formatAsText(result).replace(/\\n/g, '\\n\\n');
  return { msgtype: 'action_card', action_card: { title: '标题生成结果', markdown: text, single_title: '查看全部', single_url: btns[0]?.actionURL || '#', btns } };
}

// 新增：搜索结果格式化
function formatSearchResult(result) {
  // 输入：{ coreWord, blueOceanWord, modifiers, products }
  const coreWord = result?.coreWord ?? '';
  const blueOceanWord = result?.blueOceanWord ?? '';
  const modifiers = result?.modifiers || [];
  const products = (result?.products || []).slice(0, 15);

  const lines = [];
  lines.push(`📝 核心词: ${coreWord} | 蓝海词: ${blueOceanWord}`);
  if (modifiers.length > 0) {
    const modsText = modifiers.map(m => `${m.word}(${m.rigidity || ''})`).join(', ');
    lines.push(`修饰词: ${modsText}`);
  }
  lines.push(``);
  lines.push(`📊 找到 ${products.length} 个商品:`);
  lines.push(``);
  products.forEach((p, idx) => {
    const title = p['链接原标题'] || p['title'] || '无标题';
    lines.push(`${idx+1}. [${title}]`);
    const price = p['商品原价'] != null ? `${p['商品原价']}元` : '无价格';
    const sales = p['30天销量'] != null ? p['30天销量'] : 0;
    const link = p['产品链接'] || '';
    lines.push(`   💰 价格: ${price} | 📈 30天销量: ${sales}`);
    lines.push(`   🔗 ${link}`);
    lines.push('');
  });
  return lines.join('\n');
}

// 新增：分析结果格式化
function formatAnalysisResult(result) {
  // 输入：{ coreWord, blueOceanWord, modifiers, semanticGroups }
  const coreWord = result?.coreWord ?? '';
  const blueOceanWord = result?.blueOceanWord ?? '';
  const modifiers = result?.modifiers || [];
  const semanticGroups = result?.semanticGroups || {};

  const lines = [];
  lines.push(`📝 关键词分析: ${blueOceanWord}`);
  lines.push('');
  lines.push(`核心词: ${coreWord}`);
  lines.push(`蓝海词: ${blueOceanWord}`);
  lines.push('');
  lines.push('修饰词:');
  modifiers.forEach(m => {
    const rigidityLabel = m.rigidity === 'rigid' ? '刚性' : m.rigidity === 'optional' ? '可选' : m.rigidity;
    lines.push(`  • ${m.word} — ${rigidityLabel}（${m.group || ''}）`);
  });
  lines.push('');
  lines.push('语义族:');
  Object.entries(semanticGroups).forEach(([groupName, syns]) => {
    lines.push(`  ${groupName}: ${Array.isArray(syns) ? syns.join(', ') : syns}`);
  });
  return lines.join('\n');
}

function formatProgress(coreWord, step) {
  const msgs = { extracting: '⏳ 正在提取核心词...', searching: '⏳ 正在搜索1688商品...', generating: '⏳ 正在生成标题...' };
  return msgs[step] || '⏳ 正在处理...';
}

function formatError(error) {
  const msg = error.message || String(error);
  if (msg.includes('timeout')) return '请求超时，请稍后重试';
  if (msg.includes('API')) return '服务暂时不可用，请稍后重试';
  return '生成失败，请稍后重试';
}

module.exports = {
  formatAsText,
  formatAsFeishuCard,
  formatAsDingtalkCard,
  formatProgress,
  formatError,
  formatSearchResult,
  formatAnalysisResult,
};
