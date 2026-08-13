import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

import { uploadReviewSource } from '../../../api/workflow-api.js';

const GROUP_FIELDS = [
  ['orderDate', '刷单日期', 'date'],
  ['storeName', '店铺名', 'text'],
  ['buyerName', '买家旺旺', 'text'],
  ['buyerPhone', '买家手机号', 'text'],
  ['orderNumber', '订单号', 'text']
];

export function ReviewSourceUploadPanel({ node, onDone, onUpdateField, readOnly = false }) {
  const data = node?.data || {};
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const [uploading, setUploading] = useState(false);
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
      const result = await uploadReviewSource(file);
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

  const missingCount = groups.reduce((total, group) => total + GROUP_FIELDS.filter(([field]) => !String(group[field] || '').trim()).length, 0);

  return (
    <div className="review-source-upload-panel">
      <p className="start-configuration-hint">上传实际执行后的刷单表。系统优先按订单号分组，没有订单号时按工作表分组；重复商品会保留，旺旺、手机号和订单号只保存在本机。</p>
      <fieldset className="sheet-config-fields" disabled={readOnly || uploading}>
        <label className={`review-source-dropzone ${data.uploadId ? 'has-file' : ''}`}>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          {data.uploadId ? <FileSpreadsheet size={22} /> : <Upload size={22} />}
          <strong>{uploading ? '正在解析刷单表…' : data.uploadName || '选择刷单表'}</strong>
          <span>{data.uploadSummary ? `${data.uploadSummary.parsedSheetCount} 个订单组 · ${data.uploadSummary.productCount} 个商品` : '仅支持 .xlsx，最大 12 MB'}</span>
        </label>
        {error && <div className="artifact-error">{error}</div>}

        {groups.length > 0 && (
          <div className="review-source-groups">
            <div className="review-source-groups-head">
              <div><strong>确认订单分组</strong><span>请核对自动分组，并在这里补全真实订单信息。</span></div>
              <b className={missingCount > 0 ? 'is-missing' : ''}>{missingCount > 0 ? `${missingCount} 项待补` : '信息完整'}</b>
            </div>
            {groups.map((group, index) => (
              <section className="review-source-group" key={group.id || index}>
                <div className="review-source-group-title">
                  <strong>{group.sourceSheet || `订单组 ${index + 1}`}</strong>
                  <span>{group.products?.length || 0} 个商品 · {group.inferred ? '按工作表推断' : '按订单号识别'}</span>
                </div>
                <div className="review-source-group-fields">
                  {GROUP_FIELDS.map(([field, label, type]) => (
                    <label className="node-field" key={field}>
                      <span>{label}</span>
                      <input
                        type={type}
                        value={group[field] || ''}
                        onChange={(event) => updateGroup(index, field, event.target.value)}
                        className={!String(group[field] || '').trim() ? 'is-missing' : ''}
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
