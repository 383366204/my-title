import { useCallback, useEffect, useState } from 'react';

import { getWorkflowArtifact } from '../../../api/workflow-api.js';

const emptyArtifactState = (nodeId = null) => ({
  status: 'empty',
  nodeId,
  artifact: null,
  error: ''
});

export function useNodeArtifact({ runId, nodeId, limit } = {}) {
  const [artifactState, setArtifactState] = useState(() => emptyArtifactState(nodeId));
  // 同一节点关闭弹窗后再打开时 nodeId 不变，必须靠 token 强制重新请求，
  // 否则面板拿到的还是内存里的旧产物（例如评价草稿的自动保存内容就不会显示）。
  const [refreshToken, setRefreshToken] = useState(0);

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
  }, [limit, nodeId, refreshToken, runId]);

  const refreshArtifact = useCallback(() => setRefreshToken((token) => token + 1), []);

  return [artifactState, setArtifactState, refreshArtifact];
}
