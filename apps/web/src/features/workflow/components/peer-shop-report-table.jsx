import { Fragment } from 'react';
import { ExternalLink } from 'lucide-react';

const verdictColors = {
  qualified: 'text-emerald-400',
  unqualified: 'text-red-400',
  blocked: 'text-red-400',
  inconclusive: 'text-amber-300'
};

/**
 * 同行报告使用统一列宽，长原因不影响各店铺指标对齐。
 * @param {object} props 结构化店铺视图。
 * @returns {import('react').JSX.Element} 店铺清单。
 */
export function PeerShopReportTable({ rows, emptyText }) {
  return (
    <div className="min-w-0 max-h-[420px] overflow-auto border border-[rgba(148,163,184,0.2)] rounded-md">
      <table className="w-full min-w-[560px] table-fixed border-collapse text-xs text-[var(--text-body)]" aria-label="同行店铺清单">
        <colgroup>
          <col className="w-[32%]" /><col className="w-[18%]" />
          <col className="w-[16%]" /><col className="w-[18%]" /><col className="w-[16%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-[var(--bg-panel,#111827)] text-[var(--text-muted)]">
          <tr>
            <th scope="col" className="px-3 py-2.5 text-left font-medium">店铺名称</th>
            <th scope="col" className="px-3 py-2.5 text-left font-medium">评估状态</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">达标商品</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">已确认货源</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-[var(--text-muted)]">{emptyText}</td></tr>}
          {rows.map((row, index) => (
            <Fragment key={row.raw.shopKey || `${row.title}-${index}`}>
              <tr className="border-t border-[rgba(148,163,184,0.2)] align-top">
                <th scope="row" className="px-3 pt-3 pb-2 text-left font-semibold break-words">{row.title}</th>
                <td className={`px-3 pt-3 pb-2 ${verdictColors[row.raw.verdict] || 'text-[var(--text-muted)]'}`}>{row.metrics[0] || '待评估'}</td>
                <td className="px-3 pt-3 pb-2 text-right tabular-nums">{row.raw.paymentQualifiedCount ?? row.raw.qualifiedProductsCount ?? 0}</td>
                <td className="px-3 pt-3 pb-2 text-right tabular-nums">{row.raw.sourcingConfirmedCount ?? row.raw.sourcingMatchedCount ?? 0}</td>
                <td className="px-3 pt-3 pb-2 text-right">
                  {row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-end gap-1 text-sky-400 hover:text-sky-300 hover:underline whitespace-nowrap" aria-label={`打开${row.title}`}><ExternalLink size={12} /> 进店</a> : <span className="text-[var(--text-muted)]">无链接</span>}
                </td>
              </tr>
              {row.description && <tr><td colSpan={5} className="px-3 pb-3 text-[11px] leading-relaxed text-[var(--text-muted)] break-words"><span className="font-medium">评估原因：</span>{row.description}</td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
