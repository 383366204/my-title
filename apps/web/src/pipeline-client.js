async function fetchPipelineJson(url, options) {
  const res = await fetch(url, options);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `请求失败: ${res.status}`);
  }
  return payload.data ?? payload;
}

export function getCurrentPipelineRun({ limit = 12 } = {}) {
  return fetchPipelineJson(`/api/pipeline/current?limit=${encodeURIComponent(limit)}`);
}

export function startPipelineRun(payload) {
  return fetchPipelineJson('/api/pipeline/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

export function runPipelineStep(runId, step, payload) {
  return fetchPipelineJson(`/api/pipeline/runs/${encodeURIComponent(runId)}/${encodeURIComponent(step)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

export function appendPipelineCandidates(runId, candidates, payload = {}) {
  return fetchPipelineJson(`/api/pipeline/runs/${encodeURIComponent(runId)}/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      candidates: Array.isArray(candidates) ? candidates : []
    })
  });
}
