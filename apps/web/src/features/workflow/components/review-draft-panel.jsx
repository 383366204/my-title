import { useEffect, useState } from 'react';
import { Check, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';

import {
  MAX_REVIEW_ATTACHMENTS,
  deleteReviewAttachment,
  listReviewAttachments,
  reviewAttachmentUrl,
  uploadReviewAttachment
} from '../../../api/workflow-api.js';

const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/gif';

export function ReviewDraftPanel({ artifactState, onConfirm, confirming = false, currentRunId }) {
  const artifactRows = artifactState?.artifact?.rows;
  const [rows, setRows] = useState([]);
  const [attachments, setAttachments] = useState({});
  const [uploadingDraftId, setUploadingDraftId] = useState('');
  const [attachmentError, setAttachmentError] = useState('');

  useEffect(() => {
    const sourceRows = Array.isArray(artifactRows) ? artifactRows : [];
    setRows(sourceRows.map((row) => ({ ...row })));
  }, [artifactRows]);

  useEffect(() => {
    if (!currentRunId) {
      setAttachments({});
      return undefined;
    }
    let cancelled = false;
    listReviewAttachments(currentRunId)
      .then((data) => { if (!cancelled) setAttachments(data?.items || {}); })
      .catch(() => { if (!cancelled) setAttachments({}); });
    return () => { cancelled = true; };
  }, [currentRunId]);

  if (artifactState?.status === 'loading') return <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载评价草稿…</div>;
  if (artifactState?.status === 'error') return <div className="artifact-error">{artifactState.error || '评价草稿加载失败'}</div>;
  if (rows.length === 0) return <div className="artifact-empty">还没有评价草稿，请先运行流水线。</div>;

  const updateRow = (index, field, value) => setRows((current) => current.map((row, rowIndex) => (
    rowIndex === index ? { ...row, [field]: value } : row
  )));
  const emptyCount = rows.filter((row) => !String(row.reviewContent || '').trim()).length;
  const attachmentsOf = (row) => (Array.isArray(attachments[row.id]) ? attachments[row.id] : []);

  const handleFiles = async (row, fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0 || !currentRunId) return;
    setAttachmentError('');
    setUploadingDraftId(row.id);
    try {
      let latest = attachmentsOf(row);
      for (const file of files) {
        if (latest.length >= MAX_REVIEW_ATTACHMENTS) {
          setAttachmentError(`每条评价最多 ${MAX_REVIEW_ATTACHMENTS} 张图片，多余的已跳过`);
          break;
        }
        const result = await uploadReviewAttachment(currentRunId, row.id, file);
        latest = Array.isArray(result?.attachments) ? result.attachments : latest;
      }
      setAttachments((current) => ({ ...current, [row.id]: latest }));
    } catch (error) {
      setAttachmentError(error.message || '配图上传失败');
    } finally {
      setUploadingDraftId('');
    }
  };

  const handleRemove = async (row, attachment) => {
    if (!currentRunId) return;
    setAttachmentError('');
    try {
      const result = await deleteReviewAttachment(currentRunId, row.id, attachment.id);
      setAttachments((current) => ({ ...current, [row.id]: Array.isArray(result?.attachments) ? result.attachments : [] }));
    } catch (error) {
      setAttachmentError(error.message || '配图删除失败');
    }
  };

  return (
    <div className="review-draft-panel">
      <div className="review-source-groups-head">
        <div><strong>评价草稿</strong><span>评价不复述商品标题；仍引用标题的内容已被系统换成通用文案，请逐条核对后再生成 Excel。</span></div>
        <b className={emptyCount > 0 ? 'is-missing' : ''}>{emptyCount > 0 ? `${emptyCount} 条未填写` : `${rows.length} 条可导出`}</b>
      </div>
      {attachmentError && <div className="artifact-error">{attachmentError}</div>}
      <div className="review-draft-list">
        {rows.map((row, index) => (
          <article className="review-draft-row" key={row.id || index}>
            <div>
              <strong>{row.title}</strong>
              <span>
                {row.sourceSheet} · 第 {row.sourceRow} 行
                {row.origin === 'replaced' && <em className="review-draft-replaced">已替换引用标题的文案</em>}
              </span>
            </div>
            <label className="node-field">
              <span>评价内容</span>
              <textarea rows="3" maxLength="500" value={row.reviewContent || ''} onChange={(event) => updateRow(index, 'reviewContent', event.target.value)} />
            </label>
            <label className="node-field">
              <span>对应文件</span>
              <input type="text" maxLength="200" value={row.correspondingFile || ''} onChange={(event) => updateRow(index, 'correspondingFile', event.target.value)} placeholder="可留空，上传图片后自动填入文件名" />
            </label>
            <div className="review-draft-attachments">
              <div className="review-draft-attachments-head">
                <span>对应文件图片</span>
                <small>{attachmentsOf(row).length} / {MAX_REVIEW_ATTACHMENTS}</small>
              </div>
              {attachmentsOf(row).length > 0 && (
                <div className="review-draft-attachment-list">
                  {attachmentsOf(row).map((attachment) => (
                    <figure className="review-draft-attachment" key={attachment.id}>
                      <img src={reviewAttachmentUrl(currentRunId, attachment.id)} alt={attachment.name} loading="lazy" />
                      <figcaption title={attachment.name}>{attachment.name}</figcaption>
                      <button type="button" title="删除图片" disabled={uploadingDraftId === row.id} onClick={() => handleRemove(row, attachment)}>
                        <Trash2 size={11} />
                      </button>
                    </figure>
                  ))}
                </div>
              )}
              <label className={`review-draft-upload ${attachmentsOf(row).length >= MAX_REVIEW_ATTACHMENTS ? 'is-full' : ''}`}>
                <input
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  multiple
                  disabled={!currentRunId || uploadingDraftId === row.id || attachmentsOf(row).length >= MAX_REVIEW_ATTACHMENTS}
                  onChange={(event) => { handleFiles(row, event.target.files); event.target.value = ''; }}
                />
                {uploadingDraftId === row.id ? <RefreshCw size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                <span>
                  {uploadingDraftId === row.id
                    ? '上传中…'
                    : attachmentsOf(row).length >= MAX_REVIEW_ATTACHMENTS
                      ? `已达 ${MAX_REVIEW_ATTACHMENTS} 张上限`
                      : '上传图片'}
                </span>
              </label>
            </div>
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
