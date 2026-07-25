import { useEffect, useState } from 'react';

import { getWorkflowArtifact } from '../../../api/workflow-api.js';

const emptyArtifactState = (nodeId = null) => ({
  status: 'empty',
  nodeId,
  artifact: null,
  error: ''
});

export function useNodeArtifact({ runId, nodeId, limit } = {}) {
  const [artifactState, setArtifactState] = useState(() => emptyArtifactState(nodeId));

  useEffect(() => {
    if (!nodeId || !runId) {
      setArtifactState(emptyArtifactState(nodeId));
      return undefined;
    }

    let cancelled = false;
    setArtifactState({ status: 'loading', nodeId, artifact: null, error: '' });
    getWorkflowArtifact(runId, nodeId, { limit })
      .then((artifact) => {
        if (!cancelled) {
          setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId, artifact, error: '' });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setArtifactState({ status: 'error', nodeId, artifact: null, error: error.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [limit, nodeId, runId]);

  return [artifactState, setArtifactState];
}
