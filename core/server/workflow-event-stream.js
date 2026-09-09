'use strict';

/**
 * Stream snapshots and append-only runtime events, resuming from a browser cursor.
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {object} options Snapshot and event readers with injectable timer functions.
 * @returns {void}
 */
function streamWorkflowEvents(req, res, { readSnapshot, readEvents, schedule = setInterval, unschedule = clearInterval }) {
  const initial = readSnapshot();
  if (!initial) {
    res.status(404).json({ ok: false, error: '未找到运行记录' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const write = (event, payload, id) => res.write(`${id ? `id: ${id}\n` : ''}data: ${JSON.stringify({ event, payload })}\n\n`);
  const snapshot = (value) => ({ status: value.status, nodeStates: value.nodeStates });
  let lastSnapshot = JSON.stringify(snapshot(initial));
  write('init', snapshot(initial));
  const events = readEvents();
  const cursor = Number(req.headers['last-event-id']);
  const start = Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= events.length
    ? cursor
    : Math.max(0, events.length - 100);
  // 事件文件仅追加，用行序号提供兼容旧运行的稳定游标。
  const writeEvents = (rows, from, replay) => rows.slice(from).forEach((event, offset) => {
    const eventId = String(from + offset + 1);
    write(event.event || event.type || 'runtime_event', { ...event, replay, eventId }, eventId);
  });
  writeEvents(events, start, true);
  write('status_change', { status: initial.status });
  let eventCount = events.length;
  const timer = schedule(() => {
    try {
      const latestEvents = readEvents();
      writeEvents(latestEvents, eventCount, false);
      eventCount = latestEvents.length;
      const latest = readSnapshot();
      if (!latest) {
        write('status_change', { status: 'cancelled' });
        unschedule(timer);
        res.end();
        return;
      }
      const nextSnapshot = JSON.stringify(snapshot(latest));
      if (nextSnapshot === lastSnapshot) return;
      lastSnapshot = nextSnapshot;
      write('init', snapshot(latest));
      write('status_change', { status: latest.status });
    } catch (error) {
      write('log', { level: 'error', message: error.message });
    }
  }, 3000);
  req.on('close', () => unschedule(timer));
}

module.exports = { streamWorkflowEvents };
