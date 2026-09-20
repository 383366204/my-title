import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { indexCategoryRoots, flattenCategoryRoots, previewCategoryRoots } from '../../../apps/web/src/features/workflow/category-root-utils.js';
const require = createRequire(import.meta.url);
const { extractCategories } = require('../../../scripts/extract-1688-categories.cjs');
const snapshot = require('../../../apps/web/src/features/workflow/data/1688-categories.json');

test('snapshot preserves real categories and collapses redundant parent-child copies', () => {
  assert.equal(snapshot.categories.length, 52);
  assert.equal(flattenCategoryRoots(snapshot.categories).length, snapshot.counts.after);
  const nodes = flattenCategoryRoots(indexCategoryRoots(snapshot.categories));
  assert.equal(new Set(nodes.map(n => n.key)).size, nodes.length);
  for (const node of nodes) assert.ok(!node.children.some(c => c.id === node.id && c.name === node.name));
  assert.equal(snapshot.categories.find(n => n.name === '男装').children.length, 38);
});

test('append preserves original text and normalizes duplicate words using existing parser', () => {
  const original = '男式T恤\n ABC ';
  const result = previewCategoryRoots(original, [{ name: '男式T恤' }, { name: 'abc' }, { name: '工装、制服' }]);
  assert.equal(result.text, original + '\n工装\n制服');
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.split.length, 1);
  assert.equal(previewCategoryRoots(original, [{ name: '男式T恤' }]).text, original);
  assert.equal(previewCategoryRoots('', [{ name: '男装' }, { name: '男式T恤' }, { name: '男式T恤' }]).text, '男装\n男式T恤');
});

test('extractor accepts JSON only and removes non-category properties', () => {
  const data = { data: { treeData: [{ cateId: '1', title: '男装', secret: 'private', children: [{ cateId: '1', title: '男装', children: [{ cateId: '2', title: 'T恤' }] }] }] } };
  const html = `<script id="suspense-script-category">window.x.set('category', ${JSON.stringify(data)})</script>`;
  const result = extractCategories(html);
  assert.equal(result.counts.collapsed, 1);
  assert.equal(result.categories[0].children[0].name, 'T恤');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.throws(() => extractCategories('<script id="suspense-script-category">x.set(\'category\', alert(1))</script>'));
});
