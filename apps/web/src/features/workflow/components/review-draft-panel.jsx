import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';

import {
  MAX_REVIEW_ATTACHMENTS,
  deleteReviewAttachment,
  listReviewAttachments,
  reviewAttachmentUrl,
  saveReviewDrafts,
  uploadReviewAttachment
} from '../../../api/workflow-api.js';
import { collectChangedReviews, snapshotDraftRows } from '../review-draft-autosave.js';

const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/gif';
// 停止输入 0.8 秒后落盘一次，避免每个按键都打请求
const AUTOSAVE_DELAY_MS = 800;

export function ReviewDraftPanel({ artifactState, onConfirm, confirming = false, currentRunId }) {
  const artifactRows = artifactState?.artifact?.rows;
  const [rows, setRows] = useState([]);
  const [attachments, setAttachments] = useState({});
  const [uploadingDraftId, setUploadingDraftId] = useState('');
  const [attachmentError, setAttachmentError] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  const rowsRef = useRef([]);
  const baselineRef = useRef(new Map());
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // 从节点产物加载草稿。本地还有未落盘修改时跳过覆盖，避免刷新打断正在输入的内容；
  // 自动保存成功后基线会更新，刷新拿到的服务端数据也已经带上缓存修改。
  useEffect(() => {
    if (dirtyRef.current) return;
    const sourceRows = Array.isArray(artifactRows) ? artifactRows : [];
    const next = sourceRows.map((row) => ({ ...row }));
    setRows(next);
    baselineRef.current = snapshotDraftRows(next);
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

  const flushSave = useCallback(async ({ keepalive = false } = {}) => {
    if (!currentRunId) return;
    const changed = collectChangedReviews(rowsRef.current, baselineRef.current);
    if (changed.length === 0) {
      dirtyRef.current = false;
      return;
    }
    if (!keepalive) setSaveStatus('saving');
    try {
      await saveReviewDrafts(currentRunId, changed, keepalive ? { keepalive: true } : {});
      // 只把「保存后没再被改过」的行并入基线；保存期间的新输入仍保持脏状态，
      // 且输入时已经排过新的防抖保存，这里无需再补调度
      for (const item of changed) {
        const row = rowsRef.current.find((current) => String(current.id) === item.id);
        if (row
          && String(row.reviewContent || '') === item.reviewContent
          && String(row.correspondingFile || '') === item.correspondingFile) {
          baselineRef.current.set(item.id, {
            reviewContent: item.reviewContent,
            correspondingFile: item.correspondingFile
          });
        }
      }
      dirtyRef.current = collectChangedReviews(rowsRef.current, baselineRef.current).length > 0;
      if (!keepalive && !dirtyRef.current) {
        setSaveStatus('saved');
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        setSaveError('');
      }
    } catch (error) {
      if (keepalive) return; // 关窗兜底失败无法提示，只能放弃
      dirtyRef.current = true;
      setSaveStatus('error');
      setSaveError(error.message || '自动保存失败');
    }
  }, [currentRunId]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushSave();
    }, AUTOSAVE_DELAY_MS);
  }, [flushSave]);

  // 卸载或切换运行时，把还没落盘的修改立刻补一次（旧 runId 的闭包会写回旧运行）
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current) flushSave();
  }, [flushSave]);

  // 浏览器窗口关闭/刷新前兜底：keepalive 请求在页面卸载后仍会发出
  useEffect(() => {
    const handlePageHide = () => {
      if (!dirtyRef.current) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flushSave({ keepalive: true });
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [flushSave]);

  if (artifactState?.status === 'loading') return <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载评价草稿…</div>;
  if (artifactState?.status === 'error') return <div className="artifact-error">{artifactState.error || '评价草稿加载失败'}</div>;
  if (rows.length === 0) return <div className="artifact-empty">还没有评价草稿，请先运行流水线。</div>;

  const updateRow = (index, field, value) => {
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
    scheduleSave();
  };

  const handleConfirm = () => {
    // 确认接口本身会带上全部行内容，取消挂起的自动保存，避免和生成表格抢写草稿文件
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = false;
    baselineRef.current = snapshotDraftRows(rowsRef.current);
    onConfirm(rowsRef.current);
  };

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
      {saveStatus === 'saving' && <div className="review-autosave-hint">正在自动保存修改…</div>}
      {saveStatus === 'saved' && <div className="review-autosave-hint">修改已自动保存 {savedAt}，关闭窗口后仍会保留</div>}
      {saveStatus === 'error' && (
        <div className="artifact-error">自动保存失败：{saveError}。修改仍保留在本页，可继续编辑或直接确认生成。</div>
      )}
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
        <button type="button" className="node-primary-button" disabled={confirming || emptyCount > 0} onClick={handleConfirm}>
          {confirming ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          {confirming ? '正在生成评价表…' : '确认评价并生成表格'}
        </button>
      </div>
    </div>
  );
}