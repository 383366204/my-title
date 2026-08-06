import { parseExactKeywords } from '../../../workflow-ui.js';

const DAILY_START_FIELDS = [
  { key: 'mine', label: '候选词上限', min: 1, max: 200 },
  { key: 'rootLimit', label: '每日词根数', min: 1, max: 20 },
  { key: 'rootCooldownDays', label: '词根冷却天数', min: 0, max: 60 },
  { key: 'familyCooldownDays', label: '商品族冷却天数', min: 0, max: 60 },
  { key: 'verify', label: '生意参谋校验', min: 1, max: 200 },
  { key: 'verifyReserve', label: '备用词补验数量', min: 0, max: 30 },
  { key: 'select', label: '货源选品', min: 1, max: 100 },
  { key: 'generate', label: '标题生成', min: 1, max: 100 },
  { key: 'export', label: '导出清单数量', min: 1, max: 100 },
  { key: 'productsPerKeyword', label: '每词货源数', min: 1, max: 50 },
  { key: 'length', label: '标题长度', min: 30, max: 80 },
  { key: 'pages', label: '采集页数', min: 1, max: 5 }
];

const DAILY_START_OPTIONS = [
  { key: 'discoveryMode', label: '每日发现方式', options: [{ value: 'inspiration', label: '动态灵感（推荐）' }, { value: 'hybrid', label: '动态灵感 + 种子补位' }, { value: 'seed', label: '旧种子池模式' }] },
  { key: 'source', label: '种子补位来源', seedOnly: true, options: [{ value: 'sycm_hot', label: '生意参谋热搜关联词' }, { value: 'sycm_blue', label: '生意参谋蓝海关联词' }, { value: 'local', label: '本地规则扩展' }, { value: 'hybrid', label: '本地规则 + AI' }] },
  { key: 'rootMode', label: '种子词根模式', seedOnly: true, options: [{ value: 'auto', label: '自动提取短词根' }, { value: 'seed', label: '直接使用种子词' }] },
  { key: 'autoAllowReviewKeywords', label: '严格词为空时', options: [{ value: 'true', label: '继续少量可复核词' }, { value: 'false', label: '停在验真等待处理' }] }
];

export function StartConfigurationPanel({ mode, modeHint, node, onDone, onUpdateField }) {
  if (!node) return <div className="artifact-empty">启动节点不存在。</div>;
  const data = node.data || {};

  if (mode === 'keyword') {
    const keywordText = data.keywordsText
      ?? (Array.isArray(data.keywords) ? data.keywords.join('\n') : data.keyword || '');
    const keywords = parseExactKeywords(keywordText);
    return (
      <div className="start-configuration-panel">
        <p className="start-configuration-hint">{modeHint}</p>
        <label className="node-field">
          <span>精确关键词 <b className={keywords.length > 20 ? 'is-invalid' : ''}>{keywords.length}/20</b></span>
          <textarea
            className="node-field-textarea"
            rows="9"
            value={keywordText}
            onChange={(event) => onUpdateField(node.id, 'keywordsText', event.target.value)}
            placeholder={'每行输入一个关键词，例如：\n纯银项链女\n桌面收纳盒\n宠物磨牙玩具'}
          />
          <small>支持换行、逗号或分号分隔，重复关键词会自动合并。</small>
        </label>
        <label className="node-field start-configuration-number">
          <span>标题长度</span>
          <input
            type="number"
            min="30"
            max="80"
            value={data.length ?? 60}
            onChange={(event) => onUpdateField(node.id, 'length', Number.parseInt(event.target.value, 10) || 60)}
          />
        </label>
        <div className="start-configuration-actions">
          <button type="button" className="node-primary-button" onClick={onDone}>完成配置</button>
        </div>
      </div>
    );
  }

  return (
    <div className="start-configuration-panel">
      <p className="start-configuration-hint">{modeHint}</p>
      <div className="start-configuration-grid">
        {DAILY_START_OPTIONS.filter((field) => (
          !field.seedOnly || ['seed', 'hybrid'].includes(data.discoveryMode)
        )).map((field) => (
          <label className="node-field start-configuration-wide" key={field.key}>
            <span>{field.label}</span>
            <select
              value={data[field.key] ?? field.options[0].value}
              onChange={(event) => onUpdateField(node.id, field.key, event.target.value)}
            >
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ))}
        {DAILY_START_FIELDS.map((field) => (
          <label className="node-field" key={field.key}>
            <span>{field.label}</span>
            <input
              type="number"
              min={field.min}
              max={field.max}
              value={data[field.key] ?? ''}
              onChange={(event) => onUpdateField(node.id, field.key, Number.parseInt(event.target.value, 10) || field.min)}
            />
          </label>
        ))}
      </div>
      <div className="start-configuration-actions">
        <button type="button" className="node-primary-button" onClick={onDone}>完成配置</button>
      </div>
    </div>
  );
}
