import { useState } from 'react';

const CUSTOM_VALUE = '__custom__';

/** @param {object} props 商品及后端类目操作。 @returns {import('react').JSX.Element} 类目选择与查询。 */
export function CategoryControl({ row, actions, onUpdateEdit, compact }) {
  const record = row.categoryRecord;
  const control = row.categoryControl;
  const disabled = row.removed || !record || control?.busy || control?.state?.locked
    || control?.state?.job?.status === 'running' || control?.state?.job?.inFlight;

  // Determine if user has chosen custom category
  const isCustom = row.customCategoryMode === true;
  const customCategory = row.customCategory || '';

  // Merge info lines into one string
  const infoParts = [];
  if (record?.category && record?.source !== 'sycm_manual') infoParts.push('生意参谋指标推荐');
  else if (!record?.category) infoParts.push('尚未确定铺货类目');
  if (record?.queryWord) infoParts.push(`查询词：${record.queryWord}`);
  if (record?.source1688Category) infoParts.push(`1688类目：${record.source1688Category}`);
  if (record?.collectedAt) infoParts.push(new Date(record.collectedAt).toLocaleString('zh-CN'));
  if (record?.legacyCategory) infoParts.push(`历史：${record.legacyCategory}`);

  const handleSelectChange = (event) => {
    const value = event.target.value;
    if (value === CUSTOM_VALUE) {
      onUpdateEdit?.(row.key, 'customCategoryMode', true);
    } else {
      onUpdateEdit?.(row.key, 'customCategoryMode', false);
      onUpdateEdit?.(row.key, 'customCategory', '');
      control?.act({ action: 'select', url: record.url, category: value });
    }
  };

  // Current select value: custom mode shows CUSTOM_VALUE, otherwise show record category
  const selectValue = isCustom ? CUSTOM_VALUE : (record?.category || '');

  if (compact) {
    return <div className="flex items-center gap-1.5 min-w-0 flex-1">
      <select aria-label="铺货类目" disabled={disabled} value={selectValue}
        onChange={handleSelectChange}
        style={{ fontSize: '11px' }}
        className={`${isCustom ? 'flex-1' : 'flex-[2]'} min-w-[80px] py-1 px-[7px] border border-slate-700 rounded-[5px] bg-[#18212f] text-slate-200 font-normal leading-[1.4]`}>
        <option value="" disabled>{record?.candidates?.length ? '请选择参谋候选类目' : '待获取参谋类目'}</option>
        {(record?.candidates || []).map(item => <option key={item.category} value={item.category}>{item.category}</option>)}
        <option value={CUSTOM_VALUE}>用户指定类目</option>
      </select>
      {isCustom && <input aria-label="自定义类目" placeholder="请输入自定义类目" value={customCategory} disabled={row.removed}
        onChange={event => onUpdateEdit?.(row.key, 'customCategory', event.target.value)}
        style={{ fontSize: '11px' }}
        className="flex-1 min-w-[60px] py-1 px-[7px] border border-slate-700 rounded-[5px] bg-[#091224] text-slate-200 font-normal leading-[1.4] focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55" />}
      {actions && <div className="flex gap-1 shrink-0">{actions}</div>}
    </div>;
  }

  return <div className="grid gap-1 min-w-0 text-[11px]">
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 w-[56px] text-slate-400 text-[11px] font-bold whitespace-nowrap">铺货类目</span>
      <select aria-label="铺货类目" disabled={disabled} value={selectValue}
        onChange={handleSelectChange}
        style={{ fontSize: '11px' }}
        className={`${isCustom ? 'flex-1' : 'flex-[3]'} min-w-[120px] py-1 px-[7px] border border-slate-700 rounded-[5px] bg-[#18212f] text-slate-200 font-normal leading-[1.4]`}>
        <option value="" disabled>{record?.candidates?.length ? '请选择参谋候选类目' : '待获取参谋类目'}</option>
        {(record?.candidates || []).map(item => <option key={item.category} value={item.category}>{item.category}{item.clickRatio != null ? ` · 点击人数占比 ${item.clickRatio}%` : ''}{item.clickRate != null ? ` · 点击率 ${item.clickRate}%` : ''}</option>)}
        <option value={CUSTOM_VALUE}>用户指定类目</option>
      </select>
      {isCustom && <input aria-label="自定义类目" placeholder="请输入自定义类目" value={customCategory} disabled={row.removed}
        onChange={event => onUpdateEdit?.(row.key, 'customCategory', event.target.value)}
        style={{ fontSize: '11px' }}
        className="flex-1 min-w-[80px] py-1 px-[7px] border border-slate-700 rounded-[5px] bg-[#091224] text-slate-200 font-normal leading-[1.4] focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55" />}
      {actions && <div className="flex gap-1 shrink-0 [&_.node-secondary-button]:!min-h-[26px] [&_.node-secondary-button]:!py-0.5 [&_.node-secondary-button]:!px-[7px] [&_.node-secondary-button]:!text-[11px]">{actions}</div>}
    </div>
    {!isCustom && infoParts.length > 0 && <p className="m-0 text-slate-400 text-[10px] leading-[1.3] truncate">{infoParts.join(' · ')}</p>}
    {record?.error && <p className="m-0 text-rose-300 text-[10px]" role="alert">{record.error}</p>}
  </div>;
}
