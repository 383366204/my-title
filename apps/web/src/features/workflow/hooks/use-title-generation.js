import { useEffect, useState } from 'react';

import { generateTitle } from '../../../api/title-api.js';
import { getWorkflowArtifact } from '../../../api/workflow-api.js';
import { artifactItems, candidateKeyword } from '../workflow-data.js';

export function useTitleGeneration({ active, runId }) {
  const [titleForm, setTitleForm] = useState({ keyword: '', maxLength: 60, peerTitles: '' });
  const [titleLoading, setTitleLoading] = useState(false);
  const [titleResult, setTitleResult] = useState(null);
  const [titleError, setTitleError] = useState('');
  const [verifiedArtifactRows, setVerifiedArtifactRows] = useState([]);

  useEffect(() => {
    if (!active || !runId) {
      setVerifiedArtifactRows([]);
      return;
    }
    let cancelled = false;
    getWorkflowArtifact(runId, 'verify')
      .then((artifact) => {
        if (!cancelled) setVerifiedArtifactRows(artifactItems({ artifact }));
      })
      .catch(() => {
        if (!cancelled) setVerifiedArtifactRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, runId]);

  const useVerifiedKeyword = (row = {}) => {
    const keyword = candidateKeyword(row);
    if (keyword) setTitleForm((current) => ({ ...current, keyword }));
  };

  const generateTitleFromNode = async (event) => {
    event.preventDefault();
    setTitleLoading(true);
    setTitleError('');
    setTitleResult(null);
    try {
      const peerTitles = titleForm.peerTitles.split('\n').map((item) => item.trim()).filter(Boolean);
      const data = await generateTitle({
        keyword: titleForm.keyword,
        maxLength: titleForm.maxLength,
        useImageSearch: false,
        peerTitles: peerTitles.length > 0 ? peerTitles : null
      });
      setTitleResult(data);
    } catch (error) {
      setTitleError(`${error.message}。可以补充同行标题后重试。`);
    } finally {
      setTitleLoading(false);
    }
  };

  return {
    titleForm,
    setTitleForm,
    titleLoading,
    titleResult,
    titleError,
    verifiedArtifactRows,
    useVerifiedKeyword,
    generateTitleFromNode
  };
}
