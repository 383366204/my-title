const test = require('node:test');
const assert = require('node:assert/strict');
const { streamWorkflowEvents } = require('../../../core/server/workflow-event-stream');

test('SSE resumes from Last-Event-ID and synchronizes terminal snapshot before status', () => {
  let current = { status: 'running', nodeStates: { select: { status: 'running' } } };
  const events = [1, 2, 3].map(current => ({ event: 'progress', current }));
  const frames = [];
  let tick;
  let cleanup;
  let stopped = false;
  streamWorkflowEvents({ headers: { 'last-event-id': '2' }, on: (_name, fn) => { cleanup = fn; } }, {
    setHeader() {}, flushHeaders() {}, write: frame => frames.push(frame)
  }, {
    readSnapshot: () => current,
    readEvents: () => events,
    schedule: fn => { tick = fn; return 1; },
    unschedule: () => { stopped = true; }
  });
  assert.equal(frames.filter(frame => frame.startsWith('id:')).length, 1);
  assert.match(frames[1], /^id: 3\n/);
  assert.match(frames[1], /"replay":true/);
  events.push({ event: 'progress', current: 4 });
  current = { status: 'completed', nodeStates: { end: { status: 'completed' } } };
  tick();
  assert.match(frames[3], /^id: 4\n/);
  assert.match(frames.at(-2), /"event":"init"/);
  assert.match(frames.at(-1), /"status":"completed"/);
  cleanup();
  assert.equal(stopped, true);
});

test('SSE deletion ends the connection and missing runs never schedule polling', () => {
  let current = { status: 'running', nodeStates: {} };
  let tick;
  let ended = false;
  let stopped = 0;
  const frames = [];
  const options = {
    readSnapshot: () => current,
    readEvents: () => [],
    schedule: fn => { tick = fn; return 7; },
    unschedule: id => { assert.equal(id, 7); stopped++; }
  };
  streamWorkflowEvents({ headers: {}, on() {} }, {
    setHeader() {}, flushHeaders() {}, write: frame => frames.push(frame), end: () => { ended = true; }
  }, options);
  current = null;
  tick();
  assert.equal(ended, true);
  assert.equal(stopped, 1);
  assert.match(frames.at(-1), /"status":"cancelled"/);
  let code;
  streamWorkflowEvents({ headers: {}, on() {} }, {
    status(value) { code = value; return this; }, json(value) { assert.equal(value.ok, false); }
  }, { ...options, schedule() { assert.fail('missing runs must not create timers'); } });
  assert.equal(code, 404);
});
