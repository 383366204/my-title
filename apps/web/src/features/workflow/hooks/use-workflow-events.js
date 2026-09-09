import { useCallback, useEffect, useRef } from 'react';

import { workflowEventsUrl } from '../../../api/workflow-api.js';
import { createWorkflowEventConnection } from '../workflow-event-connection.js';

export function useWorkflowEvents({ onMessage, onMalformedMessage, onConnectionError, onReconnect } = {}) {
  const sourceRef = useRef(null);
  const callbacksRef = useRef({ onMessage, onMalformedMessage, onConnectionError, onReconnect });

  useEffect(() => {
    callbacksRef.current = { onMessage, onMalformedMessage, onConnectionError, onReconnect };
  }, [onConnectionError, onMalformedMessage, onMessage, onReconnect]);

  const disconnect = useCallback(() => {
    sourceRef.current?.disconnect();
    sourceRef.current = null;
  }, []);

  const connect = useCallback((runId) => {
    disconnect();
    const connection = createWorkflowEventConnection(workflowEventsUrl(runId), {
      onMessage: (...args) => callbacksRef.current.onMessage?.(...args),
      onMalformedMessage: () => callbacksRef.current.onMalformedMessage?.(),
      onConnectionError: (...args) => callbacksRef.current.onConnectionError?.(...args),
      onReconnect: () => callbacksRef.current.onReconnect?.()
    });
    sourceRef.current = connection;
    return connection;
  }, [disconnect]);

  useEffect(() => disconnect, [disconnect]);

  return { connect, disconnect };
}
