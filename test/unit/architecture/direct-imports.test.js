'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const retiredEntries = [
  'apps/web/src/workflow-ui.js',
  'apps/web/src/features/workflow/components/workflow-nodes.jsx',
  'core/workflow/index.js',
  'core/workflow/pipeline-adapter.js',
  ...['alibaba1688', 'keyword-mining', 'pipeline-flow', 'sycm-research', 'taobao-opc', 'title-gen']
    .map(skill => `skills/${skill}/index.js`)
];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', 'test', 'tests'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:js|jsx|mjs|cjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [file] : [];
  });
}

test('retired forwarding entry points stay removed', () => {
  for (const file of retiredEntries) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});

test('test files stay inside the root test directory', () => {
  const misplaced = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist', 'test'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:test|spec)\.(?:js|jsx|mjs|cjs)$/.test(entry.name)) misplaced.push(path.relative(root, file));
    }
  };
  visit(root);
  assert.deepEqual(misplaced, []);
});

test('production modules resolve literal relative imports directly', () => {
  const failures = [];
  for (const dir of ['bin', 'core', 'skills', 'apps/web/src']) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const source = fs.readFileSync(file, 'utf8');
      const requests = [
        ...source.matchAll(/\b(?:require(?:\.resolve)?|import)\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g),
        ...source.matchAll(/(?:^|\n)\s*import\s+(?:[^;]*?\s+from\s+)?(['"])(\.[^'"]+)\1/g)
      ];
      const resolve = createRequire(file).resolve;
      for (const match of requests) {
        try {
          resolve(match[2]);
        } catch {
          failures.push(`${path.relative(root, file)} -> ${match[2]}`);
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});
