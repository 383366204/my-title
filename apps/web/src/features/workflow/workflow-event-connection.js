/**
 * 建立单个只读事件连接，原生 EventSource 负责重连。
 * @param {string} url SSE URL.
 * @param {object} options Callbacks and injectable EventSource constructor.
 * @returns {{disconnect: Function}} Connection handle.
 */
export function createWorkflowEventConnection(url, { EventSourceClass = globalThis.EventSource, onMessage, onMalformedMessage, onConnectionError, onReconnect } = {}) {
  const source = new EventSourceClass(url);
  let closed = false;
  let interrupted = false;
  let lastEventId = '';
  const connection = {
    disconnect() {
      closed = true;
      source.close();
    }
  };
  source.onmessage = (event) => {
    if (closed) return;
    let data;
    try { data = JSON.parse(event.data); }
    catch { onMalformedMessage?.(); return; }
    if (!data || typeof data !== 'object' || typeof data.event !== 'string') {
      onMalformedMessage?.();
      return;
    }
    // init/status 帧不参与日志游标去重；浏览器会沿用前一帧的 lastEventId。
    const eventId = data.payload?.eventId;
    if (eventId) {
      if (lastEventId && Number(eventId) <= Number(lastEventId)) return;
      lastEventId = String(eventId);
    }
    onMessage?.(data, connection);
  };
  source.onopen = () => {
    if (closed) return;
    if (interrupted) onReconnect?.();
    interrupted = false;
  };
  source.onerror = () => {
    if (closed) return;
    const reconnecting = source.readyState !== 2;
    if (!interrupted || !reconnecting) onConnectionError?.({ reconnecting });
    interrupted = true;
    if (!reconnecting) connection.disconnect();
  };
  return connection;
}
