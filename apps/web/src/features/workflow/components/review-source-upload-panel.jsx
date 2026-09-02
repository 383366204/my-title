import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

import { regroupReviewSource, uploadReviewSource } from '../../../api/workflow-api.js';
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

  const missingCount = groups.reduce((total, group) => total + REVIEW_GROUP_FIELDS.filter(({ field, required }) => (
    required && !String(group[field] || '').trim()
  )).length, 0);

  return (
    <div className="review-source-upload-panel">
      <p className="start-configuration-hint">上传实际执行后的刷单表。系统优先按订单号分组；表里没有订单号时，按下面的「每组商品数」顺序切分。修改每组数量会重新分组，已填写的订单信息需要重新核对。旺旺、手机号和订单号只保存在本机。</p>
      <fieldset className="sheet-config-fields" disabled={readOnly || uploading}>
        <label className="node-field review-source-group-size">
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

        {groups.length > 0 && (
          <div className="review-source-groups">
            <div className="review-source-groups-head">
              <div><strong>确认订单分组</strong><span>请核对自动分组；店铺名和日期必填，旺旺、手机号和订单号可稍后补录。</span></div>
              <b className={missingCount > 0 ? 'is-missing' : ''}>{missingCount > 0 ? `${missingCount} 项待补` : '信息完整'}</b>
            </div>
            {groups.map((group, index) => (
              <section className="review-source-group" key={group.id || index}>
                <div className="review-source-group-title">
                  <strong>{group.sourceSheet || `订单组 ${index + 1}`}</strong>
                  <span>{group.products?.length || 0} 个商品 · {group.inferred ? '按工作表推断' : '按订单号识别'}</span>
                </div>
                <div className="review-source-group-fields">
                  {REVIEW_GROUP_FIELDS.map(({ field, label, type, required }) => (
                    <label className="node-field" key={field}>
                      <span>{label}{!required && <em className="review-field-optional">选填</em>}</span>
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
