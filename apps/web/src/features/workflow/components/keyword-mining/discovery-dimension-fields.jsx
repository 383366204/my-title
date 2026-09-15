const DIMENSIONS = { persona: '人群', profession: '职业', hobby: '爱好', scene: '场景', problem: '痛点' };

/**
 * 多维需求分析配置，直接保存到开始节点。
 * @param {object} props 节点数据与更新回调。
 * @returns {import('react').JSX.Element} 维度选择和自定义需求。
 */
export function DiscoveryDimensionFields({ node, onUpdateField, readOnly }) {
  const data = node.data || {};
  const selected = Array.isArray(data.enabledDimensions) ? data.enabledDimensions : Object.keys(DIMENSIONS);
  return <section className="start-configuration-wide">
    <strong>需求分析维度</strong>
    <div className="start-configuration-grid">
      {Object.entries(DIMENSIONS).map(([key, label]) => <div key={key}>
        <label className="discovery-dimension-toggle">
          <input type="checkbox" checked={selected.includes(key)} disabled={readOnly}
            onChange={(event) => onUpdateField(node.id, 'enabledDimensions', event.target.checked ? [...selected, key] : selected.filter(value => value !== key))} />
          {label}
        </label>
        {selected.includes(key) && <label className="node-field">
          <span>自定义{label}</span>
          <textarea rows={2} disabled={readOnly} value={(data.customInputs?.[key] || []).join('\n')}
            onChange={(event) => onUpdateField(node.id, 'customInputs', { ...data.customInputs, [key]: event.target.value.split('\n') })} />
        </label>}
      </div>)}
    </div>
    <p className="start-configuration-hint">词根复查间隔：30 天。同类商品不统一禁查。</p>
  </section>;
}
