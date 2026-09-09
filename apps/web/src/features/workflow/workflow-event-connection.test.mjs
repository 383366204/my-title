import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowEventConnection } from './workflow-event-connection.js';

function setup() {
  let source;
  const received = [];
  const errors = [];
  let recoveries = 0;
  class FakeSource {
    constructor() { source = this; this.readyState = 0; this.closed = false; }
    close() { this.closed = true; }
  }
  const connection = createWorkflowEventConnection('/events', {
    EventSourceClass: FakeSource,
    onMessage: data => received.push(data),
    onConnectionError: error => errors.push(error),
    onReconnect: () => recoveries++
  });
  const emit = (event, payload) => source.onmessage({ data: JSON.stringify({ event, payload }) });
  return { source, connection, received, errors, emit, recoveries: () => recoveries };
}

test('transient disconnect lets EventSource reconnect and deduplicates replay, not snapshots', () => {
  const s = setup();
  s.emit('progress', { eventId: '1' });
  s.source.onerror();
  s.source.onerror();
  assert.equal(s.source.closed, false);
  assert.equal(s.errors.length, 1);
  s.source.onopen();
  s.emit('init', { status: 'running' });
  s.emit('progress', { eventId: '1', replay: true });
  s.emit('progress', { eventId: '2', replay: true });
  s.emit('init', { status: 'completed' });
  assert.equal(s.recoveries(), 1);
  assert.deepEqual(s.received.map(row => row.event), ['progress', 'init', 'progress', 'init']);
});

test('closed connections cannot mutate a newly selected run', () => {
  const s = setup();
  s.connection.disconnect();
  s.emit('init', { status: 'failed' });
  s.source.onerror();
  assert.deepEqual(s.received, []);
  assert.deepEqual(s.errors, []);
});

test('permanent connection failure stops reconnecting', () => {
  const s = setup();
  s.source.readyState = 2;
  s.source.onerror();
  assert.equal(s.source.closed, true);
  assert.deepEqual(s.errors, [{ reconnecting: false }]);
});

test('malformed JSON and null frames cannot break the active connection', () => {
  const s = setup();
  for (const data of ['null', '[]', '"text"', '{}', '{']) {
    assert.doesNotThrow(() => s.source.onmessage({ data }));
  }
  s.emit('init', { status: 'running' });
  assert.equal(s.received.length, 1);
  assert.equal(s.source.closed, false);
});
