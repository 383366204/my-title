import { parseRootKeywords } from './workflow-launch-params.js';

/** @param {Array} categories Category snapshot. @returns {Array} Indexed tree. */
export function indexCategoryRoots(categories) {
  const visit = (nodes, path = [], parentKey = '') => nodes.map(node => {
    const key = `${parentKey}/${node.id}`;
    return { ...node, key, path: [...path, node.name], children: visit(node.children, [...path, node.name], key) };
  });
  return visit(categories);
}

/** @param {Array} nodes Tree nodes. @returns {Array} All nodes in tree order. */
export function flattenCategoryRoots(nodes) {
  return nodes.flatMap(node => [node, ...flattenCategoryRoots(node.children)]);
}

/** @param {string} text Existing roots. @param {Array} selected Selected categories. @returns {object} Exact append preview. */
export function previewCategoryRoots(text, selected) {
  const key = word => word.replace(/\s+/g, '').toLowerCase();
  const existing = new Set(parseRootKeywords(text).map(key));
  const words = parseRootKeywords(selected.map(node => node.name));
  const added = words.filter(word => !existing.has(key(word)));
  const split = selected.filter(node => parseRootKeywords(node.name).length > 1);
  return { added, duplicateCount: words.length - added.length, split, text: added.length ? `${text}${text && !text.endsWith('\n') ? '\n' : ''}${added.join('\n')}` : text };
}
