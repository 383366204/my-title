import { parseExactKeywords, parseOrderSheetManualItems } from '../../../workflow-ui.js';

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

const ORDER_SHEET_DATE_OPTIONS = [
  { value: 'latest_day', label: '最近可用单日' },
  { value: 'last_7_days', label: '最近 7 天' },
  { value: 'last_30_days', label: '最近 30 天' },
  { value: 'custom', label: '自定义日期范围' }
];

const ORDER_SHEET_SORT_OPTIONS = [
  { value: 'itmUv', label: '商品访客数' },
  { value: 'payAmt', label: '支付金额' },
  { value: 'payItmCnt', label: '支付件数' },
  { value: 'itemCartCnt', label: '商品加购件数' },
  { value: 'sucRefundAmt', label: '成功退款金额' }
];

export function StartConfigurationPanel({ mode, modeHint, node, onDone, onUpdateField, readOnly = false }) {
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

  if (mode === 'order-sheet') {
    const inputMode = ['rank', 'manual', 'hybrid'].includes(data.inputMode) ? data.inputMode : 'rank';
    const usesRank = inputMode !== 'manual';
    const usesManual = inputMode !== 'rank';
    const customDate = data.dateMode === 'custom';
    const manualInput = parseOrderSheetManualItems(data.manualItemsText || '', data.manualItems || []);
    const duplicatePreview = manualInput.duplicateItems.slice(0, 5);
    const duplicateSummary = duplicatePreview
      .map((item) => `${item.label}（出现 ${item.occurrenceCount} 次）`)
      .join('、');
    const hiddenDuplicateCount = Math.max(0, manualInput.duplicateItems.length - duplicatePreview.length);
    const updateManualText = (value) => {
      const parsed = parseOrderSheetManualItems(value, data.manualItems || []);
      onUpdateField(node.id, 'manualItemsText', value);
      onUpdateField(node.id, 'manualItems', parsed.items);
    };
    const updateManualItem = (item, field, value) => {
      const key = item.itemId || item.sourceKey;
      const nextItems = manualInput.items.map((row) => (
        (row.itemId || row.sourceKey) === key ? { ...row, [field]: value } : row
      ));
      onUpdateField(node.id, 'manualItems', nextItems);
    };
    return (
      <div className="start-configuration-panel">
        <p className="start-configuration-hint">{modeHint}</p>
        <fieldset className="sheet-config-fields" disabled={readOnly}>
        <section className="sheet-config-section order-sheet-source-section">
          <h3>商品来源</h3>
          <div className="node-segmented sheet-type-segmented" role="group" aria-label="刷单表商品来源">
            <button
              type="button"
              className={usesRank ? 'active' : ''}
              aria-pressed={usesRank}
              onClick={() => onUpdateField(node.id, 'inputMode', inputMode === 'hybrid' ? 'hybrid' : 'rank')}
            >
              生意参谋排行
            </button>
            <button
              type="button"
              className={inputMode === 'manual' ? 'active' : ''}
              aria-pressed={inputMode === 'manual'}
              onClick={() => onUpdateField(node.id, 'inputMode', 'manual')}
            >
              指定商品
            </button>
          </div>
          {usesRank && (
            <label className="sheet-config-toggle order-sheet-append-toggle">
              <input
                type="checkbox"
                checked={inputMode === 'hybrid'}
                onChange={(event) => onUpdateField(node.id, 'inputMode', event.target.checked ? 'hybrid' : 'rank')}
              />
              <span>在排行榜后追加指定商品</span>
            </label>
          )}
        </section>

        {usesManual && (
          <section className="sheet-config-section order-sheet-manual-section">
            <h3>指定商品</h3>
            <label className="node-field">
              <span>淘宝／天猫商品 ID 或链接</span>
              <textarea
                className="node-field-textarea"
                rows="7"
                value={data.manualItemsText || ''}
                onChange={(event) => updateManualText(event.target.value)}
                placeholder={'每行输入一个商品，例如：\n748392010293\nhttps://item.taobao.com/item.htm?id=748392010293'}
              />
              <small>支持淘宝、天猫和淘宝短链接，最多 100 个；1688 货源链接不能用于刷单表。</small>
            </label>
            <div className="order-sheet-parse-summary" role="status">
              <strong>{manualInput.items.length} 个有效商品</strong>
              {manualInput.duplicateCount > 0 && (
                <span className="is-duplicate" title={manualInput.duplicateItems.map((item) => `${item.label}（出现 ${item.occurrenceCount} 次）`).join('、')}>
                  重复商品 ID：{duplicateSummary}{hiddenDuplicateCount > 0 ? `，另有 ${hiddenDuplicateCount} 个` : ''}，已自动合并
                </span>
              )}
              {manualInput.invalidCount > 0 && <span className="is-invalid">{manualInput.invalidCount} 个内容无法识别</span>}
              {manualInput.truncatedCount > 0 && <span className="is-invalid">超出上限 {manualInput.truncatedCount} 个</span>}
            </div>
            {manualInput.items.length > 0 && (
              <div className="order-sheet-manual-list">
                {manualInput.items.map((item, index) => {
                  const key = item.itemId || item.sourceKey;
                  return (
                    <article className="order-sheet-manual-item" key={key}>
                      <div className="order-sheet-manual-item-head">
                        <strong>{item.itemId ? `商品 ${item.itemId}` : `短链接 ${index + 1}`}</strong>
                        <a href={item.productUrl} target="_blank" rel="noreferrer">打开商品</a>
                      </div>
                      <div className="start-configuration-grid">
                        <label className="node-field start-configuration-wide">
                          <span>商品标题 <small>可留空自动获取</small></span>
                          <input type="text" value={item.title || ''} onChange={(event) => updateManualItem(item, 'title', event.target.value)} />
                        </label>
                        <label className="node-field">
                          <span>做单金额</span>
                          <input type="number" min="0" step="0.01" value={item.orderAmount ?? ''} onChange={(event) => updateManualItem(item, 'orderAmount', event.target.value === '' ? null : Number(event.target.value))} placeholder="自动留空" />
                        </label>
                        <label className="node-field">
                          <span>店铺名</span>
                          <input type="text" value={item.storeName || ''} onChange={(event) => updateManualItem(item, 'storeName', event.target.value)} placeholder="可留空自动获取" />
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {usesRank && <section className="sheet-config-section order-sheet-rank-section">
          <h3>生意参谋排行条件</h3>
        <div className="start-configuration-grid">
          <label className="node-field start-configuration-wide">
            <span>日期范围</span>
            <select
              value={data.dateMode || 'latest_day'}
              onChange={(event) => onUpdateField(node.id, 'dateMode', event.target.value)}
            >
              {ORDER_SHEET_DATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {customDate && (
            <>
              <label className="node-field">
                <span>开始日期</span>
                <input type="date" value={data.startDate || ''} onChange={(event) => onUpdateField(node.id, 'startDate', event.target.value)} />
              </label>
              <label className="node-field">
                <span>结束日期</span>
                <input type="date" value={data.endDate || ''} onChange={(event) => onUpdateField(node.id, 'endDate', event.target.value)} />
              </label>
            </>
          )}
          <label className="node-field">
            <span>采集页数</span>
            <input
              type="number"
              min="1"
              max="5"
              value={data.pages ?? 1}
              onChange={(event) => onUpdateField(node.id, 'pages', Number.parseInt(event.target.value, 10) || 1)}
            />
          </label>
          <label className="node-field">
            <span>降序排序指标</span>
            <select value={data.sortMetric || 'itmUv'} onChange={(event) => onUpdateField(node.id, 'sortMetric', event.target.value)}>
              {ORDER_SHEET_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        {customDate && <div className="start-configuration-hint">自定义日期最少 1 天、最多 31 天，以生意参谋当前可选日期为准。</div>}
        </section>}
        </fieldset>
        <div className="start-configuration-actions">
          <button type="button" className="node-primary-button" onClick={onDone}>{readOnly ? '关闭' : '完成配置'}</button>
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
