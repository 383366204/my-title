import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

const SOURCE_LABELS = { news: '新闻', dictionary: '字典', calendar: '日历', trend: '趋势' };
const REJECTION_LABELS = {
  sensitive_or_negative_news: '涉及敏感或负面事件，不用于商品化',
  brand_or_ip_risk: '存在品牌或知识产权风险',
  empty_root: '没有生成商品词根',
  root_length_out_of_range: '词根长度不符合要求',
  banned_word: '命中违禁词',
  abstract_root: '仍是抽象概念，不是具体商品',
  not_concrete_product: '无法确认是可采购的具体商品',
  root_cooldown: '该词根仍在冷却期',
  family_cooldown: '同商品族仍在冷却期',
  root_score_below_threshold: '商品化与新鲜度综合分不足',
  daily_quota_or_diversity: '受每日配额或商品族多样性限制未入选'
};

const sourceLabel = (value) => SOURCE_LABELS[value] || value || '未知来源';
const rejectionLabel = (value) => REJECTION_LABELS[value] || value || '';

/**
 * 动态灵感来源与词根拦截视图组件
 * @param {object} props
 * @param {object} props.artifactState - 节点产物状态
 * @returns {import('react').JSX.Element} 动态灵感来源与词根拦截视图
 */
export const InspirationDiscoveryView = ({ artifactState }) => {
  const [dynamicTab, setDynamicTab] = useState('inspirations');
  const inspirationRows = Array.isArray(artifactState?.artifact?.inspirationRows) ? artifactState.artifact.inspirationRows : [];
  const rootRows = Array.isArray(artifactState?.artifact?.rootRows) ? artifactState.artifact.rootRows : [];
  const discoveryStats = artifactState?.artifact?.discovery?.stats || {};

  return (
    <section className="node-workbench-section">
      <div className="node-workbench-head">
        <strong>今日灵感发现</strong>
        <span>{discoveryStats.selectedRootCount || rootRows.filter((row) => row.status === 'selected').length} 个词根入选</span>
      </div>
      <div className="node-inspiration-summary">
        <span><strong>{discoveryStats.inspirationCount || inspirationRows.length}</strong> 条灵感</span>
        <span><strong>{discoveryStats.safeInspirationCount || inspirationRows.filter((row) => row.status === 'safe').length}</strong> 安全可用</span>
        <span><strong>{discoveryStats.productizedCount || rootRows.length}</strong> 个商品词根</span>
        <span className={Number(discoveryStats.inspirationRejected || 0) > 0 ? 'warning' : ''}><strong>{discoveryStats.inspirationRejected || inspirationRows.filter((row) => row.status === 'rejected').length}</strong> 条拦截</span>
      </div>
      <div className="node-segmented" role="tablist" aria-label="灵感选词链路">
        <button type="button" className={dynamicTab === 'inspirations' ? 'active' : ''} onClick={() => setDynamicTab('inspirations')}>灵感来源</button>
        <button type="button" className={dynamicTab === 'roots' ? 'active' : ''} onClick={() => setDynamicTab('roots')}>词根与拦截</button>
      </div>
      {dynamicTab === 'inspirations' ? (
        <div className="node-inspiration-list">
          {inspirationRows.slice(0, 20).map((item, index) => (
            <div className={`node-inspiration-row ${item.status === 'rejected' ? 'is-rejected' : ''}`} key={item.id || `${item.inspirationWord}-${index}`}>
              <div>
                <strong>{item.inspirationWord || item.sourceTitle || '未命名灵感'}</strong>
                <span>{item.sourceTitle || item.rawSourceText || '未记录来源'} · {sourceLabel(item.sourceType)}</span>
                {item.rejectReason && <small>拦截原因：{rejectionLabel(item.rejectReason)}</small>}
              </div>
              {item.sourceUrl && (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" title="打开灵感来源">
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          ))}
          {inspirationRows.length === 0 && <div className="artifact-empty">运行后会展示新闻、字典、日历和趋势灵感。</div>}
        </div>
      ) : (
        <div className="node-inspiration-list">
          {rootRows.slice(0, 30).map((item, index) => (
            <div className={`node-inspiration-row ${!['selected', 'eligible'].includes(item.status) ? 'is-rejected' : ''}`} key={`${item.rootKeyword}-${item.inspirationId}-${index}`}>
              <div>
                <strong>{item.rootKeyword || '未命名词根'} <em>{item.status === 'selected' ? '已入选' : item.status === 'eligible' ? '可选' : '未采用'}</em></strong>
                <span>{item.inspiration?.inspirationWord ? `灵感 ${item.inspiration.inspirationWord} → ` : ''}{item.coreProduct || item.familyKey || '待识别商品'}{item.rootScore?.total ? ` · ${Math.round(item.rootScore.total)} 分` : ''}</span>
                <small>{item.rejectReason ? `未采用原因：${rejectionLabel(item.rejectReason)}` : (item.relationReason || '已通过商品化校验')}</small>
              </div>
            </div>
          ))}
          {rootRows.length === 0 && <div className="artifact-empty">运行后会展示商品词根及每条未采用原因。</div>}
        </div>
      )}
    </section>
  );
};
