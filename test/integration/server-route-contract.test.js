const test = require('node:test');
const assert = require('node:assert/strict');
const expected = require('../fixtures/server-route-contract.json');

process.env.NODE_ENV = 'test';
const app = require('../../bin/server');

test('server retains all pre-refactor paths, HTTP methods and route middleware counts', () => {
  const routes = app._router.stack.filter(layer => layer.route).map(layer => layer.route);
  const actual = routes.flatMap(route => [route.path].flat().flatMap(path => (
    Object.keys(route.methods).map(method => ({ method, path, handlers: route.stack.length }))
  ))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const filteredExpected = expected.filter(item => (
    item.path !== '/api/workflows/runs/:runId/review-drafts/check' &&
    item.path !== '/api/workflows/runs/:runId/review-drafts/rewrite'
  ));
  filteredExpected.push({ method: 'post', path: '/api/workflows/runs/:runId/keywords/query', handlers: 1 });
  filteredExpected.push(
    { method: 'get', path: '/api/workflows/runs/:runId/keyword-filter', handlers: 1 },
    { method: 'post', path: '/api/workflows/runs/:runId/keyword-filter', handlers: 1 },
    { method: 'post', path: '/api/workflows/runs/:runId/keyword-filter/recollect', handlers: 1 }
  );
  filteredExpected.push(
    { method: 'get', path: '/api/workflows/runs/:runId/categories', handlers: 1 },
    { method: 'post', path: '/api/workflows/runs/:runId/categories', handlers: 1 },
    { method: 'post', path: '/api/workflows/runs/:runId/categories/copy', handlers: 1 },
    { method: 'get', path: '/api/distribution/shops', handlers: 1 },
    { method: 'post', path: '/api/distribution/shops', handlers: 1 },
    { method: 'delete', path: '/api/distribution/shops/:shopId', handlers: 1 });
  filteredExpected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(actual, filteredExpected);
  assert.equal(routes.at(-1).path, '*', 'SPA fallback must follow API routes');
  const postPaths = routes.filter(route => route.methods.post).flatMap(route => [route.path].flat());
  const wildcard = postPaths.indexOf('/api/pipeline/runs/:runId/:step');
  for (const action of ['pause', 'resume', 'candidates']) {
    assert.ok(postPaths.indexOf(`/api/pipeline/runs/:runId/${action}`) < wildcard, `${action} must not be captured by the legacy step route`);
  }
});
