export const MINER_TABS = [
  { id: 'peer', label: '同行词根', endpoint: '/api/miner/peer', needsInput: true },
  { id: 'opp', label: '1688商机', endpoint: '/api/miner/opportunities', needsInput: false },
  { id: 'sycm-market', label: '参谋关联词', endpoint: '/api/miner/sycm-market', needsInput: true }
];

export function artifactItems(state) {
  const artifact = state?.artifact || null;
  if (!artifact) return [];
  if (Array.isArray(artifact.items)) return artifact.items;
  if (Array.isArray(artifact.rows)) return artifact.rows;
  return [];
}

export function candidateKeyword(row = {}) {
  return String(row.keyword || row.word || row.title || row.query || '').trim();
}
