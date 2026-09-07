import { parseCompetitorShareInputs, parseExactKeywords, parseOrderSheetManualItems, parseRootKeywords } from '../../../workflow-ui.js';

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

  if (mode === 'competitor-analysis') {
    const parsed = parseCompetitorShareInputs(data.competitorText || '');
    return (
      <div className="start-configuration-panel competitor-start-panel">
        <p className="start-configuration-hint">{modeHint}</p>
        <fieldset className="sheet-config-fields" disabled={readOnly}>
          <section className="sheet-config-section">
            <h3>同行链接</h3>
            <label className="node-field">
              <span>淘宝分享文案、商品链接或店铺链接</span>
              <textarea
                className="node-field-textarea"
                rows="10"
                value={data.competitorText || ''}
                onChange={(event) => onUpdateField(node.id, 'competitorText', event.target.value)}
                placeholder={'可以直接粘贴完整分享文案，每行一条，例如：\n【淘宝】09₴... https://m.tb.cn/h.xxxxx\nhttps://shop123456.taobao.com/'}
              />
              <small>最多分析 10 家店铺；同一家店的多个商品或分享链接会在解析后自动合并。</small>
            </label>
            <div className="order-sheet-parse-summary" role="status">
              <strong>{parsed.links.length} 条有效链接</strong>
              {parsed.duplicateCount > 0 && <span className="is-duplicate">{parsed.duplicateCount} 条重复链接已合并</span>}
              {parsed.invalidCount > 0 && <span className="is-invalid">{parsed.invalidCount} 条非淘宝链接已忽略</span>}
              {parsed.truncatedCount > 0 && <span className="is-invalid">超出上限 {parsed.truncatedCount} 条</span>}
            </div>
          </section>
          <section className="sheet-config-section">
            <h3>采集范围</h3>
            <div className="start-configuration-grid">
              <label className="node-field"><span>最多店铺</span><input type="number" min="1" max="10" value={data.maxShops ?? 5} onChange={(event) => onUpdateField(node.id, 'maxShops', Number.parseInt(event.target.value, 10) || 1)} /></label>
              <label className="node-field"><span>每店爆款</span><input type="number" min="5" max="50" value={data.hotLimit ?? 20} onChange={(event) => onUpdateField(node.id, 'hotLimit', Number.parseInt(event.target.value, 10) || 5)} /></label>
              <label className="node-field"><span>每店新品</span><input type="number" min="5" max="50" value={data.newLimit ?? 20} onChange={(event) => onUpdateField(node.id, 'newLimit', Number.parseInt(event.target.value, 10) || 5)} /></label>
              <label className="node-field">
                <span>每榜补全商品链接</span>
                <input type="number" min="0" max="50" value={data.detailLimit ?? 20} onChange={(event) => onUpdateField(node.id, 'detailLimit', Math.max(0, Number.parseInt(event.target.value, 10) || 0))} />
                <small>默认与每店榜单数量一致；逐个打开商品获取真实链接，数量越大耗时越长。</small>
              </label>
            </div>
            <label className="sheet-config-toggle">
              <input type="checkbox" checked={data.compareHistory !== false} onChange={(event) => onUpdateField(node.id, 'compareHistory', event.target.checked)} />
              <span>保留本次快照，用于后续历史对比</span>
            </label>
          </section>
        </fieldset>
        <div className="start-configuration-actions">
          <button type="button" className="node-primary-button" onClick={onDone}>{readOnly ? '关闭' : '完成配置'}</button>
        </div>
      </div>
    );
  }

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

  if (mode === 'root-keyword') {
    const rootsText = data.rootsText ?? (Array.isArray(data.roots) ? data.roots.join('\n') : '');
    const roots = parseRootKeywords(rootsText);
    const rawRootCount = String(rootsText || '').split(/[\r\n,，;；、]+/).map((item) => item.trim()).filter(Boolean).length;
    const duplicateCount = Math.max(0, rawRootCount - roots.length);
    const riskProfile = data.sycmRiskProfile || 'standard';
    const updateSeconds = (field, value, fallback) => {
      onUpdateField(node.id, field, Math.max(0, Number.parseInt(value, 10) || fallback) * 1000);
    };
    const updateMinutes = (field, value, fallback) => {
      onUpdateField(node.id, field, Math.max(0, Number.parseInt(value, 10) || fallback) * 60000);
    };
    return (
      <div className="start-configuration-panel root-keyword-start-panel">
        <p className="start-configuration-hint">{modeHint}</p>
        <fieldset className="sheet-config-fields" disabled={readOnly}>
          <section className="sheet-config-section">
            <h3>词根来源</h3>
            <label className="node-field">
              <span>词根 <b>{roots.length} 个</b></span>
              <textarea
                className="node-field-textarea"
                rows="10"
                value={rootsText}
                onChange={(event) => onUpdateField(node.id, 'rootsText', event.target.value)}
                placeholder={'每行输入一个词根，例如：\n杯垫\n收纳\n项链\n露营'}
              />
              <small>支持换行、逗号或分号分隔，不限制数量；重复词根会自动合并。</small>
            </label>
            <div className="order-sheet-parse-summary" role="status">
              <strong>{roots.length} 个有效词根</strong>
              {duplicateCount > 0 && <span className="is-duplicate">{duplicateCount} 个重复词根会自动合并</span>}
            </div>
          </section>

          <section className="sheet-config-section">
            <h3>生意参谋查询</h3>
            <div className="start-configuration-grid">
              <label className="node-field">
                <span>拓词方式</span>
                <select value={data.sycmMode || 'hot'} onChange={(event) => onUpdateField(node.id, 'sycmMode', event.target.value)}>
                  <option value="hot">热搜关联词</option>
                  <option value="blue">蓝海关联词</option>
                </select>
              </label>
              <label className="node-field">
                <span>数据周期</span>
                <select value={data.period || '7d'} onChange={(event) => onUpdateField(node.id, 'period', event.target.value)}>
                  <option value="7d">最近 7 天</option>
                  <option value="30d">最近 30 天</option>
                  <option value="day">日</option>
                  <option value="week">周</option>
                  <option value="month">月</option>
                </select>
              </label>
              <label className="node-field">
                <span>对比方式</span>
                <select value={data.compareType || 'cycle'} onChange={(event) => onUpdateField(node.id, 'compareType', event.target.value)}>
                  <option value="cycle">环比</option>
                  <option value="yearSync">同比</option>
                </select>
              </label>
              <label className="node-field">
                <span>风控节奏</span>
                <select value={riskProfile} onChange={(event) => onUpdateField(node.id, 'sycmRiskProfile', event.target.value)}>
                  <option value="standard">标准：45～90秒/词根</option>
                  <option value="conservative">保守：90～180秒/词根</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
            </div>
            {riskProfile === 'custom' && (
              <div className="start-configuration-grid root-keyword-timing-grid">
                <label className="node-field"><span>最短间隔（秒）</span><input type="number" min="15" max="600" value={Math.round((data.sycmMinIntervalMs ?? 45000) / 1000)} onChange={(event) => updateSeconds('sycmMinIntervalMs', event.target.value, 45)} /></label>
                <label className="node-field"><span>最长间隔（秒）</span><input type="number" min="15" max="900" value={Math.round((data.sycmMaxIntervalMs ?? 90000) / 1000)} onChange={(event) => updateSeconds('sycmMaxIntervalMs', event.target.value, 90)} /></label>
                <label className="node-field"><span>每批词根数</span><input type="number" min="1" max="100" value={data.sycmBatchSize ?? 10} onChange={(event) => onUpdateField(node.id, 'sycmBatchSize', Math.max(1, Number.parseInt(event.target.value, 10) || 10))} /></label>
                <label className="node-field"><span>批次最短休息（分钟）</span><input type="number" min="1" max="60" value={Math.round((data.sycmMinBatchCooldownMs ?? 300000) / 60000)} onChange={(event) => updateMinutes('sycmMinBatchCooldownMs', event.target.value, 5)} /></label>
                <label className="node-field"><span>批次最长休息（分钟）</span><input type="number" min="1" max="120" value={Math.round((data.sycmMaxBatchCooldownMs ?? 600000) / 60000)} onChange={(event) => updateMinutes('sycmMaxBatchCooldownMs', event.target.value, 10)} /></label>
              </div>
            )}
            <p className="node-workbench-note">查询始终单并发执行。页面关闭、暂停或平台阻塞后，会从未完成词根继续。</p>
          </section>

          <section className="sheet-config-section">
            <h3>后续生成</h3>
            <div className="start-configuration-grid">
              <label className="node-field"><span>标题长度</span><input type="number" min="30" max="80" value={data.length ?? 60} onChange={(event) => onUpdateField(node.id, 'length', Number.parseInt(event.target.value, 10) || 60)} /></label>
              <label className="node-field"><span>每词货源参考数</span><input type="number" min="1" max="50" value={data.productsPerKeyword ?? 12} onChange={(event) => onUpdateField(node.id, 'productsPerKeyword', Number.parseInt(event.target.value, 10) || 12)} /></label>
            </div>
          </section>
        </fieldset>
        <div className="start-configuration-actions">
          <button type="button" className="node-primary-button" onClick={onDone}>{readOnly ? '关闭' : '完成配置'}</button>
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
