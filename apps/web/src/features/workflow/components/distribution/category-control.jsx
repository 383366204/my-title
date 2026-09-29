/** @param {object} props 商品及后端类目操作。 @returns {import('react').JSX.Element} 类目选择与查询。 */
export function CategoryControl({ row, actions, onUpdateEdit }) {
  const record = row.categoryRecord;
  const control = row.categoryControl;
  const disabled = row.removed || !record || control?.busy || control?.state?.locked
    || control?.state?.job?.status === 'running' || control?.state?.job?.inFlight;

  // Merge info lines into one string
  const infoParts = [];
  if (record?.source === 'sycm_manual') infoParts.push('已人工确认参谋候选');
  else if (record?.category) infoParts.push('生意参谋指标推荐');
  else infoParts.push('尚未确定铺货类目');
  if (record?.queryWord) infoParts.push(`查询词：${record.queryWord}`);
  if (record?.source1688Category) infoParts.push(`1688：${record.source1688Category}`);
  if (record?.collectedAt) infoParts.push(new Date(record.collectedAt).toLocaleString('zh-CN'));
  if (record?.legacyCategory) infoParts.push(`历史：${record.legacyCategory}`);

  const customCategory = row.customCategory || '';

  return <div className="grid gap-1 min-w-0 text-[11px]">
    {/* Row 1: label + select + custom category input + actions */}
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 w-[56px] text-slate-400 text-[11px] font-bold whitespace-nowrap">铺货类目</span>
      <select aria-label="铺货类目（生意参谋）" disabled={disabled} value={record?.category || ''}
        onChange={event => control?.act({ action: 'select', url: record.url, category: event.target.value })}
        style={{ fontSize: '11px' }}
        className="flex-[3] min-w-[120px] py-1 px-[7px] border border-slate-700 rounded-[5px] bg-[#18212f] text-slate-200 font-normal leading-[1.4]">
        <option value="">{record?.candidates?.length ? '请选择参谋候选类目' : '待获取参谋类目'}</option>
        {(record?.candidates || []).map(item => <option key={item.category} value={item.category}>{item.category}{item.clickRatio != null ? ` · 点击人数占比 ${item.clickRatio}%` : ''}{item.clickRate != null ? ` · 点击率 ${item.clickRate}%` : ''}</option>)}
      </select>
      <input aria-label="自定义类目" placeholder="请输入自定义类目" value={customCategory} disabled={row.removed}
        onChange={event => onUpdateEdit?.(row.key, 'customCategory', event.target.value)}
        style={{ fontSize: '11px' }}
        className="flex-1 min-w-[80px] py-1 px-[7px] border border-slate-700 rounded-[5px] bg-[#091224] text-slate-200 font-normal leading-[1.4] focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55" />
      {actions && <div className="flex gap-1 shrink-0 [&_.node-secondary-button]:!min-h-[26px] [&_.node-secondary-button]:!py-0.5 [&_.node-secondary-button]:!px-[7px] [&_.node-secondary-button]:!text-[11px]">{actions}</div>}
    </div>
    {/* Row 2: merged info line */}
    {infoParts.length > 0 && <p className="m-0 text-slate-400 text-[10px] leading-[1.3] truncate">{infoParts.join(' · ')}</p>}
    {record?.error && <p className="m-0 text-rose-300 text-[10px]" role="alert">{record.error}</p>}
  </div>;
}
