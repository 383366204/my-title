import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

import { regroupReviewSource, uploadReviewSource } from '../../../api/review-api.js';
import { applyPastedOrders, parsePastedOrders } from '../review-paste-parser.js';
import { REVIEW_GROUP_FIELDS } from '../review-group-fields.js';

// 没有订单号时按这个粒度切分订单组
const GROUP_SIZE_OPTIONS = [1, 2, 3, 4];
const DEFAULT_GROUP_SIZE = 4;

export function ReviewSourceUploadPanel({ node, onDone, onUpdateField, readOnly = false }) {
  const data = node?.data || {};
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const groupSize = GROUP_SIZE_OPTIONS.includes(Number(data.groupSize)) ? Number(data.groupSize) : DEFAULT_GROUP_SIZE;
  const [uploading, setUploading] = useState(false);
  const [regrouping, setRegrouping] = useState(false);
  const [error, setError] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteNotice, setPasteNotice] = useState('');

  const updateGroups = (nextGroups) => onUpdateField(node.id, 'groups', nextGroups);
  const updateGroup = (index, field, value) => updateGroups(groups.map((group, current) => (
    current === index ? { ...group, [field]: value } : group
  )));

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await uploadReviewSource(file, groupSize);
      onUpdateField(node.id, 'uploadId', result.uploadId);
      onUpdateField(node.id, 'uploadName', result.fileName);
      onUpdateField(node.id, 'uploadSummary', {
        sheetCount: result.sheetCount,
        parsedSheetCount: result.parsedSheetCount,
        productCount: result.productCount,
        skippedSheets: result.skippedSheets || []
      });
      onUpdateField(node.id, 'groups', result.groups || []);
    } catch (uploadError) {
      setError(uploadError.message || '刷单表上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleGroupSize = async (nextSize) => {
    onUpdateField(node.id, 'groupSize', nextSize);
    if (!data.uploadId) return;
    setRegrouping(true);
    setError('');
    try {
      // 换组数会重算分组，之前逐组填写的订单信息需要重新核对
      const result = await regroupReviewSource(data.uploadId, nextSize);
      onUpdateField(node.id, 'uploadSummary', {
        sheetCount: result.sheetCount,
        parsedSheetCount: result.parsedSheetCount,
        productCount: result.productCount,
        skippedSheets: result.skippedSheets || []
      });
      onUpdateField(node.id, 'groups', result.groups || []);
    } catch (regroupError) {
      setError(regroupError.message || '重新分组失败');
    } finally {
      setRegrouping(false);
    }
  };

  const handlePasteFill = () => {
    setPasteNotice('');
    const records = parsePastedOrders(pasteText);
    if (records.length === 0) {
      setPasteNotice('没有识别到订单信息，请确认每行都是「订单编号：xxx」这类格式');
      return;
    }
    const result = applyPastedOrders(groups, records);
    updateGroups(result.groups);
    const parts = [];
    if (result.summary.byOrderNumber > 0) parts.push(`按订单号匹配 ${result.summary.byOrderNumber} 单`);
    if (result.summary.sequential > 0) parts.push(`按顺序填充 ${result.summary.sequential} 单`);
    if (result.summary.skipped > 0) parts.push(`${result.summary.skipped} 单没有可填的分组`);
    setPasteNotice(`识别到 ${records.length} 单${parts.length > 0 ? `：${parts.join('，')}` : ''}。只补空字段，不会覆盖已填内容。`);
  };
    const missingCount = groups.reduce((total, group) => total + REVIEW_GROUP_FIELDS.filter(({ field, required }) => (
    required && !String(group[field] || '').trim()
  )).length, 0);

  return (
    <div className="grid gap-3.5">
      <p className="start-configuration-hint">上传实际执行后的刷单表。系统优先按订单号分组；表里没有订单号时，按下面的「每组商品数」顺序切分。修改每组数量会重新分组，已填写的订单信息需要重新核对。旺旺、手机号和订单号只保存在本机。</p>
      <fieldset className="sheet-config-fields" disabled={readOnly || uploading}>
        <label className="node-field">
          <span>每组商品数</span>
          <select
            value={groupSize}
            disabled={readOnly || uploading || regrouping}
            onChange={(event) => handleGroupSize(Number(event.target.value))}
          >
            {GROUP_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size === 1 ? '1（不合并，逐件一组）' : `${size} 个一组`}</option>)}
          </select>
          <small>{regrouping ? '正在重新分组…' : data.uploadId ? '修改后立即按新粒度重算分组' : '选择文件后自动按该粒度分组'}</small>
        </label>
        <label className={`review-source-dropzone ${data.uploadId ? 'has-file' : ''}`}>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          {data.uploadId ? <FileSpreadsheet size={22} /> : <Upload size={22} />}
          <strong>{uploading ? '正在解析刷单表…' : regrouping ? '正在重新分组…' : data.uploadName || '选择刷单表'}</strong>
          <span>{data.uploadSummary ? `${data.uploadSummary.parsedSheetCount} 个订单组 · ${data.uploadSummary.productCount} 个商品 · 每组 ${groupSize} 件` : '仅支持 .xlsx，最大 12 MB'}</span>
        </label>
        {error && <div className="artifact-error">{error}</div>}
        {groups.length > 0 && !readOnly && (
          <details className="rounded-[7px] border border-slate-600/[0.68] bg-slate-900/[0.56] px-3 py-2.5 [&>summary]:cursor-pointer [&>summary]:text-xs [&>summary]:font-bold [&>summary]:text-slate-300 [&>textarea]:mt-2 [&>textarea]:min-h-[118px] [&>textarea]:w-full [&>textarea]:resize-y [&>textarea]:rounded-[6px] [&>textarea]:border [&>textarea]:border-slate-600/70 [&>textarea]:bg-slate-950/[0.72] [&>textarea]:px-2.5 [&>textarea]:py-2 [&>textarea]:text-xs [&>textarea]:leading-[1.7] [&>textarea]:text-slate-200 [&>textarea:focus]:border-sky-400/60 [&>textarea:focus]:outline-none" open={groups.some(group => !group.buyerName || !group.buyerPhone)}>
            <summary>粘贴订单信息自动填充旺旺、手机号和订单号</summary>
            <textarea
              rows="6"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'订单编号：3316868653089013989\n买家旺旺：penguin玄珠\n收货电话：14727236390-8997\n\n可一次粘贴多单：同一字段再次出现会自动拆分成下一单'}
            />
            <div className="mt-2 flex gap-2 [&>button]:cursor-pointer [&>button]:rounded-[6px] [&>button]:border [&>button]:border-sky-400/[0.42] [&>button]:bg-sky-400/[0.14] [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-xs [&>button]:text-sky-300 [&>button:disabled]:cursor-not-allowed [&>button:disabled]:opacity-45">
              <button type="button" disabled={uploading || regrouping} onClick={handlePasteFill}>识别并填充</button>
              <button type="button" disabled={uploading || regrouping || !pasteText} onClick={() => { setPasteText(''); setPasteNotice(''); }}>清空</button>
            </div>
            {pasteNotice && <div className="mt-2 rounded-[5px] bg-sky-400/10 px-[9px] py-1.5 text-[11px] text-sky-300">{pasteNotice}</div>}
          </details>
        )}

        {groups.length > 0 && (
          <div className="grid gap-2.5">
            <div className="flex items-center justify-between gap-2 [&>b]:whitespace-nowrap [&>b]:rounded-[5px] [&>b]:px-[7px] [&>b]:py-[5px] [&>b]:text-[10px] [&>b]:text-emerald-300 [&>b.is-missing]:bg-amber-500/[0.14] [&>b.is-missing]:text-yellow-300 [&>div]:grid [&>div]:min-w-0 [&>div]:gap-[3px]">
              <div><strong>确认订单分组</strong><span className="text-[10px] text-slate-400">请核对自动分组；店铺名和日期必填，旺旺、手机号和订单号可稍后补录。</span></div>
              <b className={missingCount > 0 ? 'is-missing' : ''}>{missingCount > 0 ? `${missingCount} 项待补` : '信息完整'}</b>
            </div>
            {groups.map((group, index) => (
              <section className="grid gap-1.5 rounded-[7px] border border-slate-600/[0.72] bg-slate-900/[0.56] px-2.5 py-2 [&>details]:text-[10px] [&>details]:text-slate-400 [&>details_summary]:cursor-pointer [&>ol]:mt-2 [&>ol]:pl-5 [&>ol]:leading-normal" key={group.id || index}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <strong>{group.sourceSheet || `订单组 ${index + 1}`}</strong>
                  <span className="text-[10px] text-slate-400">{group.products?.length || 0} 个商品 · {group.inferred ? '按工作表推断' : '按订单号识别'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1 [&>.node-field:first-child]:col-span-full [&>.node-field:first-child]:max-w-[220px] max-md:[&>.node-field:first-child]:col-auto">
                  {REVIEW_GROUP_FIELDS.map(({ field, label, type, required }) => (
                    <label className="node-field" key={field}>
                      <span>{label}{!required && <em className="ml-1 rounded bg-slate-600/[0.34] px-1 py-px text-[10px] not-italic text-slate-400">选填</em>}</span>
                      <input
                        type={type}
                        value={group[field] || ''}
                        onChange={(event) => updateGroup(index, field, event.target.value)}
                        className={required && !String(group[field] || '').trim() ? 'is-missing' : ''}
                      />
                    </label>
                  ))}
                </div>
                <details>
                  <summary>查看识别到的商品</summary>
                  <ol>{(group.products || []).map((product) => <li key={product.id}>{product.title}</li>)}</ol>
                </details>
              </section>
            ))}
          </div>
        )}
      </fieldset>
      <div className="start-configuration-actions">
        <button type="button" className="node-primary-button" disabled={!readOnly && !data.uploadId} onClick={onDone}>
          {readOnly ? '关闭' : data.uploadId ? '完成配置' : '请先选择文件'}
        </button>
      </div>
    </div>
  );
}
