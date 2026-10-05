import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

import { regroupReviewSource, uploadReviewSource } from '../../../api/review-api.js';
import { parsePastedOrder } from '../review-paste-parser.js';
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
  const [pasteNotice, setPasteNotice] = useState('');
  const [pasteValues, setPasteValues] = useState({});

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
      setPasteValues({});
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
      setPasteValues({});
    } catch (regroupError) {
      setError(regroupError.message || '重新分组失败');
    } finally {
      setRegrouping(false);
    }
  };

  // 按订单粘贴识别：粘贴哪一单的文本就填哪一单，识别到的字段直接更新
  const fillFromPastedText = (index, text) => {
    setPasteNotice('');
    const record = parsePastedOrder(text);
    if (!record) {
      setPasteNotice('未识别到订单编号 / 买家旺旺 / 收货电话，请检查粘贴内容格式（例：订单编号：xxx）');
      return false;
    }
    const filled = [];
    if (record.orderNumber) filled.push('订单号');
    if (record.buyerName) filled.push('买家旺旺');
    if (record.buyerPhone) filled.push('收货电话');
    updateGroups(groups.map((group, current) => (
      current === index
        ? {
          ...group,
          orderNumber: record.orderNumber || group.orderNumber,
          buyerName: record.buyerName || group.buyerName,
          buyerPhone: record.buyerPhone || group.buyerPhone
        }
        : group
    )));
    setPasteNotice(`订单组 ${index + 1} 已识别填充：${filled.join('、')}`);
    return true;
  };

  // 点击按钮才识别填入；识别成功后清空粘贴框，失败保留内容便于修改
  const handleParseClick = (index) => {
    const text = String(pasteValues[index] || '').trim();
    if (!text) return;
    if (fillFromPastedText(index, text)) {
      setPasteValues((current) => ({ ...current, [index]: '' }));
    }
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
        {pasteNotice && <div className="rounded-[5px] bg-sky-400/10 px-[9px] py-1.5 text-[11px] text-sky-300">{pasteNotice}</div>}
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
                <div className="grid gap-1.5">
                  <textarea
                    rows="3"
                    className="w-full cursor-text resize-y rounded-[6px] border border-dashed border-sky-400/40 bg-sky-400/[0.06] px-2.5 py-1.5 text-xs leading-relaxed text-sky-200/90 placeholder:text-slate-500 focus:border-sky-400/70 focus:outline-none"
                    placeholder={'粘贴本单订单信息（订单编号 / 买家旺旺 / 收货电话），\n支持直接粘贴多行内容'}
                    value={pasteValues[index] || ''}
                    onChange={(event) => setPasteValues((current) => ({ ...current, [index]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) handleParseClick(index);
                    }}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="node-primary-button"
                      disabled={!String(pasteValues[index] || '').trim()}
                      onClick={() => handleParseClick(index)}
                    >
                      粘贴并识别
                    </button>
                  </div>
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
