import { useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';

export function ReviewDraftPanel({ artifactState, onConfirm, confirming = false }) {
  const artifactRows = artifactState?.artifact?.rows;
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const sourceRows = Array.isArray(artifactRows) ? artifactRows : [];
    setRows(sourceRows.map((row) => ({ ...row })));
  }, [artifactRows]);

  if (artifactState?.status === 'loading') return <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载评价草稿…</div>;
  if (artifactState?.status === 'error') return <div className="artifact-error">{artifactState.error || '评价草稿加载失败'}</div>;
  if (rows.length === 0) return <div className="artifact-empty">还没有评价草稿，请先运行流水线。</div>;

  const updateRow = (index, field, value) => setRows((current) => current.map((row, rowIndex) => (
    rowIndex === index ? { ...row, [field]: value } : row
  )));
  const emptyCount = rows.filter((row) => !String(row.reviewContent || '').trim()).length;

  return (
    <div className="review-draft-panel">
      <div className="review-source-groups-head">
        <div><strong>评价草稿</strong><span>模型只读取商品标题。请逐条核对，确认后才会生成 Excel。</span></div>
        <b className={emptyCount > 0 ? 'is-missing' : ''}>{emptyCount > 0 ? `${emptyCount} 条未填写` : `${rows.length} 条可导出`}</b>
      </div>
      <div className="review-draft-list">
        {rows.map((row, index) => (
          <article className="review-draft-row" key={row.id || index}>
            <div><strong>{row.title}</strong><span>{row.sourceSheet} · 第 {row.sourceRow} 行</span></div>
            <label className="node-field">
              <span>评价内容</span>
              <textarea rows="3" maxLength="500" value={row.reviewContent || ''} onChange={(event) => updateRow(index, 'reviewContent', event.target.value)} />
            </label>
            <label className="node-field">
              <span>对应文件</span>
              <input type="text" maxLength="200" value={row.correspondingFile || ''} onChange={(event) => updateRow(index, 'correspondingFile', event.target.value)} placeholder="可留空" />
            </label>
          </article>
        ))}
      </div>
      <div className="start-configuration-actions">
        <button type="button" className="node-primary-button" disabled={confirming || emptyCount > 0} onClick={() => onConfirm(rows)}>
          {confirming ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          {confirming ? '正在生成评价表…' : '确认评价并生成表格'}
        </button>
      </div>
    </div>
  );
}
