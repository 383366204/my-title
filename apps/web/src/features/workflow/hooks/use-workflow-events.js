import { useCallback, useEffect, useRef } from 'react';

import { workflowEventsUrl } from '../../../api/workflow-api.js';

export function useWorkflowEvents({ onMessage, onMalformedMessage, onConnectionError } = {}) {
  const sourceRef = useRef(null);
  const callbacksRef = useRef({ onMessage, onMalformedMessage, onConnectionError });

  useEffect(() => {
    callbacksRef.current = { onMessage, onMalformedMessage, onConnectionError };
  }, [onConnectionError, onMalformedMessage, onMessage]);

  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const connect = useCallback((runId) => {
    disconnect();
    const source = new EventSource(workflowEventsUrl(runId));
    sourceRef.current = source;
    const connection = {
      disconnect: () => {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
      }
    };

    source.onmessage = (event) => {
      try {
        callbacksRef.current.onMessage?.(JSON.parse(event.data), connection);
      } catch {
        callbacksRef.current.onMalformedMessage?.();
      }
    };
    source.onerror = () => {
      connection.disconnect();
      callbacksRef.current.onConnectionError?.();
    };
    return connection;
  }, [disconnect]);

  useEffect(() => disconnect, [disconnect]);

  return { connect, disconnect };
}
