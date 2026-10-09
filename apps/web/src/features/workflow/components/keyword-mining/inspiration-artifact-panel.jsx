import { useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { saveInspirationRoots } from '../../../../api/workflow-api.js';
import { ArtifactPanel } from '../artifact-panel.jsx';

/**
 * @param {object} props 节点产物状态。
 * @returns {import('react').JSX.Element} 暂停时可编辑的词根结果。
 */
export function InspirationArtifactPanel({ state }) {
  const [artifact, setArtifact] = useState(state.artifact);
  const [text, setText] = useState((state.artifact?.rows || []).map(row => row.rootKeyword).join('\n'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const saved = await saveInspirationRoots(artifact.runId, { rootsText: text, revision: artifact.revision });
      if (!mounted.current) return;
      setArtifact({ ...artifact, ...saved });
      setText(saved.rows.map(row => row.rootKeyword).join('\n'));
      setMessage('词根已保存，可关闭弹窗并继续拓词');
    } catch (error) {
      if (mounted.current) setMessage(error.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return <>
    {artifact?.editable && <section className="grid gap-2 mb-3">
      <label className="flex flex-col gap-2 min-w-0 text-sm">
        <span>待查询词根</span>
        <textarea className="w-full min-w-0 resize-y rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-sm leading-6"
          rows={6} value={text} disabled={busy} onChange={event => setText(event.target.value)} />
      </label>
      <button type="button" className="inline-flex items-center gap-2 w-fit rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50" disabled={busy || !text.trim()} onClick={save}>
        <Save size={14} /> {busy ? '保存中' : '保存词根'}
      </button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>}
    <ArtifactPanel state={{ ...state, artifact }} />
  </>;
}
