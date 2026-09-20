'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Extract only category fields from a saved homepage; never execute its scripts.
 * @param {string} html Saved homepage content.
 * @returns {object} Sanitized category snapshot.
 */
function extractCategories(html) {
  const script = html.match(/<script\b[^>]*id=["']suspense-script-category["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  const marker = ".set('category', ";
  if (!script?.includes(marker)) throw new Error('没有找到首页类目数据');
  const payload = JSON.parse(script.slice(script.indexOf(marker) + marker.length).trim().replace(/\);?$/, ''));
  const counts = { before: 0, after: 0, collapsed: 0 };
  function clean(node, parentPath = '') {
    counts.before++;
    if (!node.cateId || !String(node.title || '').trim()) throw new Error('类目缺少 ID 或名称');
    const id = String(node.cateId);
    const name = node.title.trim();
    const key = `${parentPath}/${id}`;
    let children = (node.children || []).map(child => clean(child, key));
    children = children.flatMap(child => {
      if (child.id !== id || child.name !== name) return [child];
      counts.collapsed++;
      return child.children;
    });
    const seen = new Set();
    children = children.filter(child => {
      const identity = `${child.id}:${child.name}`;
      if (seen.has(identity)) throw new Error(`重复同级类目：${key}/${identity}`);
      seen.add(identity);
      return true;
    });
    return { id, name, children };
  }
  const categories = payload.data.treeData.map(node => clean(node));
  const count = nodes => nodes.reduce((sum, node) => sum + 1 + count(node.children), 0);
  counts.after = count(categories);
  return { source: '1688 homepage saved HTML', counts, categories };
}

module.exports = { extractCategories };

if (require.main === module) {
  const [input, output, snapshotDate] = process.argv.slice(2);
  if (!input || !output || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate || '')) throw new Error('用法：node scripts/extract-1688-categories.cjs 输入.html 输出.json 快照日期');
  const snapshot = { version: 1, snapshotDate, ...extractCategories(fs.readFileSync(input, 'utf8')) };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(JSON.stringify(snapshot.counts));
}
