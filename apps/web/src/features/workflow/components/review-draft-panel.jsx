import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ImagePlus, RefreshCw, SearchCheck, Sparkles, Trash2 } from 'lucide-react';

import {
  MAX_REVIEW_ATTACHMENTS,
  MAX_REVIEW_ATTACHMENT_BYTES,
  checkReviewDrafts,
  deleteReviewAttachment,
  listReviewAttachments,
  reviewAttachmentUrl,
  rewriteReviewDrafts,
  saveReviewDrafts,
  uploadReviewAttachment
} from '../../../api/workflow-api.js';
import { collectChangedReviews, snapshotDraftRows } from '../review-draft-autosave.js';
import { canAutoCompress, compressedFileName, compressReviewImage } from '../review-image-compress.js';

const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/gif';
// 停止输入 0.8 秒后落盘一次，避免每个按键都打请求
const AUTOSAVE_DELAY_MS = 800;

export function ReviewDraftPanel({ artifactState, onConfirm, confirming = false, currentRunId }) {
  const artifactRows = artifactState?.artifact?.rows;
  const [rows, setRows] = useState([]);
  const [attachments, setAttachments] = useState({});
  const [uploadingDraftId, setUploadingDraftId] = useState('');
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [qualityError, setQualityError] = useState('');
  const [qualityAction, setQualityAction] = useState('');
  const [filter, setFilter] = useState('all');

  const rowsRef = useRef([]);
  const baselineRef = useRef(new Map());
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const replaceRows = useCallback((nextRows) => {
    const normalized = (Array.isArray(nextRows) ? nextRows : []).map(row => ({ ...row }));
    rowsRef.current = normalized;
    setRows(normalized);
    baselineRef.current = snapshotDraftRows(normalized);
    dirtyRef.current = false;
  }, []);

  const mergeQuality = useCallback((qualityById = {}) => {
    const next = rowsRef.current.map(row => ({
      ...row,
      quality: qualityById[String(row.id)] || row.quality
    }));
    rowsRef.current = next;
    setRows(next);
  }, []);

  // 从节点产物加载草稿。本地还有未落盘修改时跳过覆盖，避免刷新打断正在输入的内容；
  // 自动保存成功后基线会更新，刷新拿到的服务端数据也已经带上缓存修改。
  useEffect(() => {
    if (dirtyRef.current) return;
    const sourceRows = Array.isArray(artifactRows) ? artifactRows : [];
    replaceRows(sourceRows);
  }, [artifactRows, replaceRows]);

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
      const result = await saveReviewDrafts(currentRunId, changed, keepalive ? { keepalive: true } : {});
      if (!keepalive && result?.qualityById) mergeQuality(result.qualityById);
      // 只把「保存后没再被改过」的行并入基线；保存期间的新输入仍保持脏状态，
      // 且输入时已经排过新的防抖保存，这里无需再补调度
      for (const item of changed) {
        const row = rowsRef.current.find((current) => String(current.id) === item.id);
        if (row
          && String(row.experienceNotes || '') === item.experienceNotes
          && String(row.reviewContent || '') === item.reviewContent
          && String(row.correspondingFile || '') === item.correspondingFile) {
          baselineRef.current.set(item.id, {
            experienceNotes: item.experienceNotes,
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
      return result;
    } catch (error) {
      if (keepalive) return { failed: true }; // 关窗兜底失败无法提示，只能放弃
      dirtyRef.current = true;
      setSaveStatus('error');
      setSaveError(error.message || '自动保存失败');
      return { failed: true };
    }
  }, [currentRunId, mergeQuality]);

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
    const next = rowsRef.current.map((row, rowIndex) => (
      rowIndex === index
        ? { ...row, [field]: value, quality: field === 'reviewContent' ? { level: 'pending', reason: '等待重新检查' } : row.quality }
        : row
    ));
    rowsRef.current = next;
    setRows(next);
    scheduleSave();
  };

  const stopPendingSave = () => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const handleQualityCheck = async () => {
    if (!currentRunId || qualityAction) return;
    setQualityAction('check');
    setQualityError('');
    stopPendingSave();
    try {
      const saved = await flushSave();
      if (saved?.failed) return;
      const result = await checkReviewDrafts(currentRunId);
      if (Array.isArray(result?.rows)) replaceRows(result.rows);
    } catch (error) {
      setQualityError(error.message || '重复检查失败');
    } finally {
      setQualityAction('');
    }
  };

  const handleRewrite = async (ids) => {
    const targets = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (!currentRunId || targets.length === 0 || qualityAction) return;
    setQualityAction('rewrite');
    setQualityError('');
    stopPendingSave();
    try {
      const saved = await flushSave();
      if (saved?.failed) return;
      const result = await rewriteReviewDrafts(currentRunId, targets);
      if (Array.isArray(result?.rows)) replaceRows(result.rows);
    } catch (error) {
      setQualityError(error.message || '评价整理失败');
    } finally {
      setQualityAction('');
    }
  };

  const handleConfirm = () => {
    // 确认接口本身会带上全部行内容，取消挂起的自动保存，避免和生成表格抢写草稿文件
    stopPendingSave();
    dirtyRef.current = false;
    baselineRef.current = snapshotDraftRows(rowsRef.current);
    onConfirm(rowsRef.current);
  };

  const emptyCount = rows.filter((row) => !String(row.reviewContent || '').trim()).length;
  const missingExperienceCount = rows.filter((row) => !String(row.experienceNotes || '').trim()).length;
  const blockedCount = rows.filter((row) => row.quality?.level === 'blocked' && String(row.reviewContent || '').trim()).length;
  const warningCount = rows.filter((row) => row.quality?.level === 'warning').length;
  const actionableIds = rows.filter(row => (
    String(row.experienceNotes || '').trim()
    && (!String(row.reviewContent || '').trim() || ['blocked', 'warning'].includes(row.quality?.level))
  )).map(row => row.id);
  const visibleRows = rows.filter(row => {
    if (filter === 'problems') return ['blocked', 'warning'].includes(row.quality?.level);
    if (filter === 'missing') return !String(row.experienceNotes || '').trim() || !String(row.reviewContent || '').trim();
    return true;
  });
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
        let uploadFile = file;
        if (file.size > MAX_REVIEW_ATTACHMENT_BYTES) {
          const limitMb = MAX_REVIEW_ATTACHMENT_BYTES / 1024 / 1024;
          if (!canAutoCompress(file)) {
            setAttachmentError(`「${file.name}」超过单张 ${limitMb}MB，GIF 无法自动压缩，请转成 JPG 后上传`);
            continue;
          }
          setAttachmentNotice(`「${file.name}」 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 ${limitMb}MB，正在自动压缩…`);
          const compressed = await compressReviewImage(file, { limitBytes: MAX_REVIEW_ATTACHMENT_BYTES });
          if (!compressed || compressed.blob.size > MAX_REVIEW_ATTACHMENT_BYTES) {
            setAttachmentError(`「${file.name}」自动压缩后仍超过 ${limitMb}MB，请裁剪或降低分辨率后重试`);
            continue;
          }
          uploadFile = new File([compressed.blob], compressedFileName(file.name), { type: 'image/jpeg' });
          setAttachmentNotice(`「${file.name}」已压缩至 ${(compressed.blob.size / 1024 / 1024).toFixed(1)}MB，正在上传…`);
        }
        const result = await uploadReviewAttachment(currentRunId, row.id, uploadFile);
        latest = Array.isArray(result?.attachments) ? result.attachments : latest;
      }
      setAttachments((current) => ({ ...current, [row.id]: latest }));
    } catch (error) {
      setAttachmentError(error.message || '配图上传失败');
    } finally {
      setUploadingDraftId('');
      setAttachmentNotice('');
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
        <div><strong>真实体验整理</strong><span>先填写实际体验，再整理成评价；系统会检查本批和历史内容是否重复。</span></div>
        <b className={emptyCount > 0 || blockedCount > 0 ? 'is-missing' : ''}>
          {emptyCount > 0 ? `${emptyCount} 条待整理` : blockedCount > 0 ? `${blockedCount} 条重复` : `${rows.length} 条可导出`}
        </b>
      </div>
      {saveStatus === 'saving' && <div className="review-autosave-hint">正在自动保存修改…</div>}
      {saveStatus === 'saved' && <div className="review-autosave-hint">修改已自动保存 {savedAt}，关闭窗口后仍会保留</div>}
      {saveStatus === 'error' && (
        <div className="artifact-error">自动保存失败：{saveError}。修改仍保留在本页，可继续编辑或直接确认生成。</div>
      )}
      {attachmentNotice && <div className="review-autosave-hint">{attachmentNotice}</div>}
      {attachmentError && <div className="artifact-error">{attachmentError}</div>}
      {qualityError && <div className="artifact-error">{qualityError}</div>}
      <div className="review-quality-toolbar">
        <div className="review-quality-filters" aria-label="评价筛选">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {rows.length}</button>
          <button type="button" className={filter === 'problems' ? 'active' : ''} onClick={() => setFilter('problems')}>相似 {blockedCount + warningCount}</button>
          <button type="button" className={filter === 'missing' ? 'active' : ''} onClick={() => setFilter('missing')}>待补充 {missingExperienceCount}</button>
        </div>
        <div className="review-quality-actions">
          <button type="button" className="node-secondary-button" disabled={Boolean(qualityAction)} onClick={handleQualityCheck}>
            {qualityAction === 'check' ? <RefreshCw size={13} className="animate-spin" /> : <SearchCheck size={13} />}
            检查重复
          </button>
          <button type="button" className="node-secondary-button" disabled={actionableIds.length === 0 || Boolean(qualityAction)} onClick={() => handleRewrite(actionableIds)}>
            {qualityAction === 'rewrite' ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            整理待处理项
          </button>
        </div>
      </div>
      <div className="review-draft-list">
        {visibleRows.length === 0 && <div className="artifact-empty">当前筛选下没有内容。</div>}
        {visibleRows.map((row, visibleIndex) => {
          const index = rows.findIndex(item => String(item.id) === String(row.id));
          const qualityLevel = row.quality?.level === 'none' ? 'passed' : row.quality?.level || 'pending';
          return (
          <article className={`review-draft-row is-quality-${qualityLevel}`} key={row.id || visibleIndex}>
            <div>
              <strong>{row.title}</strong>
              <span>
                {row.sourceSheet} · 第 {row.sourceRow} 行
                {row.origin === 'replaced' && <em className="review-draft-replaced">已移除标题复述</em>}
              </span>
            </div>
            <div className={`review-quality-state is-${qualityLevel}`}>
              {qualityLevel === 'blocked' || qualityLevel === 'warning' ? <AlertTriangle size={13} /> : qualityLevel === 'passed' ? <Check size={13} /> : <SearchCheck size={13} />}
              <span>
                {qualityLevel === 'blocked' ? '重复阻塞' : qualityLevel === 'warning' ? '相似提醒' : qualityLevel === 'passed' ? '检查通过' : '等待检查'}
                {row.quality?.score > 0 ? ` · 相似度 ${Math.round(row.quality.score * 100)}%` : ''}
              </span>
              {row.quality?.reason && <small>{row.quality.reason}</small>}
            </div>
            <label className="node-field">
              <span>真实体验要点</span>
              <textarea
                rows="2"
                maxLength="500"
                disabled={Boolean(qualityAction)}
                value={row.experienceNotes || ''}
                onChange={(event) => updateRow(index, 'experienceNotes', event.target.value)}
                placeholder="只填写实际发生的体验，例如包装、尺寸、使用感受；没有体验时请留空"
              />
            </label>
            <label className="node-field">
              <span>整理后的评价</span>
              <textarea
                rows="3"
                maxLength="500"
                disabled={Boolean(qualityAction)}
                value={row.reviewContent || ''}
                onChange={(event) => updateRow(index, 'reviewContent', event.target.value)}
                placeholder={row.experienceNotes ? '可人工修改；修改后请重新检查重复' : '补充真实体验要点后才能生成'}
              />
            </label>
            <div className="review-row-actions">
              <button type="button" className="node-secondary-button" disabled={!String(row.experienceNotes || '').trim() || Boolean(qualityAction)} onClick={() => handleRewrite([row.id])}>
                <Sparkles size={13} /> 根据体验整理
              </button>
            </div>
            <label className="node-field">
              <span>对应文件</span>
              <input type="text" maxLength="200" disabled={Boolean(qualityAction)} value={row.correspondingFile || ''} onChange={(event) => updateRow(index, 'correspondingFile', event.target.value)} placeholder="可留空，上传图片后自动填入文件名" />
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
          );
        })}
      </div>
      <div className="start-configuration-actions">
        {(emptyCount > 0 || blockedCount > 0) && (
          <span className="review-confirm-blocked">
            <AlertTriangle size={13} />
            {emptyCount > 0 ? `还有 ${emptyCount} 条未整理` : `还有 ${blockedCount} 条批内重复需要修改`}
          </span>
        )}
        <button type="button" className="node-primary-button" disabled={confirming || Boolean(qualityAction) || emptyCount > 0 || blockedCount > 0} onClick={handleConfirm}>
          {confirming ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          {confirming ? '正在生成评价表…' : '确认评价并生成表格'}
        </button>
      </div>
    </div>
  );
}
