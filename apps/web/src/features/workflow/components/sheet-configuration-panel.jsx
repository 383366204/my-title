const SHEET_TYPES = [
  { value: 'order', label: '刷单表' },
  { value: 'review', label: '评价表' }
];

const AMOUNT_MODES = [
  { value: 'average', label: '平均实付金额' },
  { value: 'payment', label: '支付金额' },
  { value: 'blank', label: '留空人工填写' }
];

const MISSING_AMOUNT_POLICIES = [
  { value: 'blank', label: '留空' },
  { value: 'mark', label: '标记待填写' },
  { value: 'skip', label: '跳过该商品' }
];

function todayDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numberValue(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

export function SheetConfigurationPanel({ node, onDone, onUpdateField, readOnly = false }) {
  if (!node) return <div className="artifact-empty">制表节点不存在。</div>;
  const data = node.data || {};
  const sheetType = data.sheetType === 'review' ? 'review' : 'order';
  const update = (field, value) => onUpdateField(node.id, field, value);

  return (
    <div className="grid gap-3.5">
      <fieldset className="grid gap-3.5 min-w-0 m-0 p-0 border-0 disabled:opacity-[0.72]" disabled={readOnly}>
      {data.reviewSourceUpload !== true && data.orderSheetOnly !== true && (
      <section className="grid gap-2.5 border-b border-slate-700/72 pb-3.5 last:border-b-0 [&>h3]:m-0 [&>h3]:text-slate-200 [&>h3]:text-xs [&>h3]:tracking-normal">
        <h3>表格类型</h3>
        <div className="grid grid-cols-2 gap-1 p-[3px] rounded-lg bg-[#020617] border border-slate-800 max-w-[420px]" role="group" aria-label="表格类型">
          {SHEET_TYPES.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`min-w-0 border-0 rounded-md bg-transparent text-slate-400 text-[10px] font-bold p-1.5 ${sheetType === option.value ? 'bg-blue-700 text-white' : ''}`}
              aria-pressed={sheetType === option.value}
              onClick={() => update('sheetType', option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
      )}

      <section className="grid gap-2.5 border-b border-slate-700/72 pb-3.5 last:border-b-0 [&>h3]:m-0 [&>h3]:text-slate-200 [&>h3]:text-xs [&>h3]:tracking-normal">
        <h3>输出范围</h3>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          {data.reviewSourceUpload !== true && <label className="node-field">
            <span>店铺名</span>
            <input
              type="text"
              maxLength="50"
              value={data.storeName || ''}
              onChange={(event) => update('storeName', event.target.value)}
              placeholder="留空自动识别"
            />
          </label>}
          <label className="node-field">
            <span>商品数量</span>
            <input
              type="number"
              min="0"
              max="500"
              value={data.productLimit ?? 0}
              onChange={(event) => update('productLimit', numberValue(event.target.value, 0, 0, 500))}
            />
            <small>0 表示使用全部已采集商品</small>
          </label>
          <label className="node-field col-span-full">
            <span>文件名</span>
            <input
              type="text"
              maxLength="80"
              value={data.fileName || ''}
              onChange={(event) => update('fileName', event.target.value)}
              placeholder="留空自动命名"
            />
          </label>
          {data.reviewSourceUpload !== true && <label className="flex items-center gap-2 min-h-9 text-slate-300 text-[11px] col-span-full [&>input]:w-[15px] [&>input]:h-[15px] [&>input]:m-0 [&>input]:accent-blue-600">
            <input
              type="checkbox"
              checked={data.includeRawData !== false}
              onChange={(event) => update('includeRawData', event.target.checked)}
            />
            <span>附带商品排行原始数据工作表</span>
          </label>}
        </div>
      </section>

      {sheetType === 'order' ? (
        <section className="grid gap-2.5 border-b border-slate-700/72 pb-3.5 last:border-b-0 [&>h3]:m-0 [&>h3]:text-slate-200 [&>h3]:text-xs [&>h3]:tracking-normal">
          <h3>刷单表设置</h3>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <label className="node-field">
              <span>下单金额</span>
              <select value={data.amountMode || 'average'} onChange={(event) => update('amountMode', event.target.value)}>
                {AMOUNT_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="node-field">
              <span>金额缺失时</span>
              <select value={data.missingAmountPolicy || 'blank'} onChange={(event) => update('missingAmountPolicy', event.target.value)}>
                {MISSING_AMOUNT_POLICIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="node-field">
              <span>加购件数</span>
              <input
                type="number"
                min="1"
                max="20"
                value={data.cartQuantity ?? 1}
                onChange={(event) => update('cartQuantity', numberValue(event.target.value, 1, 1, 20))}
              />
            </label>
            <label className="node-field">
              <span>每个商品占用行数</span>
              <input
                type="number"
                min="1"
                max="5"
                value={data.rowSpan ?? 3}
                onChange={(event) => update('rowSpan', numberValue(event.target.value, 3, 1, 5))}
              />
            </label>
            <label className="node-field col-span-full">
              <span>做单要求</span>
              <textarea
                rows="3"
                maxLength="200"
                value={data.workRequirement || ''}
                onChange={(event) => update('workRequirement', event.target.value)}
              />
            </label>
            <label className="node-field col-span-full">
              <span>下单备注</span>
              <input
                type="text"
                maxLength="100"
                value={data.orderNote || ''}
                onChange={(event) => update('orderNote', event.target.value)}
                placeholder="留空人工填写"
              />
            </label>
            <label className="flex items-center gap-2 min-h-9 text-slate-300 text-[11px] col-span-full [&>input]:w-[15px] [&>input]:h-[15px] [&>input]:m-0 [&>input]:accent-blue-600">
              <input
                type="checkbox"
                checked={data.includeImages !== false}
                onChange={(event) => update('includeImages', event.target.checked)}
              />
              <span>下载商品主图并写入表格</span>
            </label>
          </div>
        </section>
      ) : (
        <section className="grid gap-2.5 border-b border-slate-700/72 pb-3.5 last:border-b-0 [&>h3]:m-0 [&>h3]:text-slate-200 [&>h3]:text-xs [&>h3]:tracking-normal">
          <h3>评价表设置</h3>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {data.reviewSourceUpload !== true && <label className="node-field">
              <span>刷单日期</span>
              <input type="date" value={data.orderDate || todayDateValue()} onChange={(event) => update('orderDate', event.target.value)} />
            </label>}
            {data.reviewSourceUpload !== true && <label className="node-field">
              <span>每组商品数</span>
              <select value={data.reviewGroupSize ?? 4} onChange={(event) => update('reviewGroupSize', Number(event.target.value))}>
                <option value="1">1 个</option>
                <option value="2">2 个</option>
                <option value="4">4 个</option>
              </select>
            </label>}
            <label className="flex items-center gap-2 min-h-9 text-slate-300 text-[11px] col-span-full [&>input]:w-[15px] [&>input]:h-[15px] [&>input]:m-0 [&>input]:accent-blue-600">
              <input
                type="checkbox"
                checked={data.includeSpacerRow !== false}
                onChange={(event) => update('includeSpacerRow', event.target.checked)}
              />
              <span>不同评价组之间保留空行</span>
            </label>
          </div>
        </section>
      )}
      </fieldset>
      <div className="sticky bottom-0 z-[2] flex justify-end mx-[-2px] mb-[-2px] px-0.5 pt-3 pb-0.5 border-t border-slate-700/[0.76] bg-slate-900">
        <button type="button" className="node-primary-button" onClick={onDone}>{readOnly ? '关闭' : '完成配置'}</button>
      </div>
    </div>
  );
}
