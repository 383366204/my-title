import { useCallback, useState } from 'react';

export function useWorkflowOverlay() {
  const [activeOverlay, setActiveOverlay] = useState(null);

  const openOverlay = useCallback((type, nodeId, options = {}) => {
    setActiveOverlay({ type, nodeId: nodeId || null, ...options });
  }, []);

  const closeOverlay = useCallback(() => {
    setActiveOverlay(null);
  }, []);

  return { activeOverlay, closeOverlay, openOverlay };
}
