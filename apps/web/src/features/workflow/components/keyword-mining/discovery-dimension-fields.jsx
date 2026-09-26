/**
 * 自由填写选词方向，直接保存到开始节点。
 * @param {object} props 节点数据与更新回调。
 * @returns {import('react').JSX.Element} 选词方向输入框。
 */
export function DiscoveryDimensionFields({ node, onUpdateField, readOnly }) {
  const data = node.data || {};
  const direction = Array.isArray(data.customInputs?.direction)
    ? data.customInputs.direction.join('\n')
    : Object.values(data.customInputs || {}).flat().filter(Boolean).join('\n');
  return <section className="start-configuration-wide">
    <label className="node-field">
      <span>选词方向</span>
      <textarea rows={4} disabled={readOnly} value={direction}
        placeholder="例如：面向独居租房年轻人，寻找小户型厨房收纳、防潮用品，排除电器和大件家具"
        onChange={event => onUpdateField(node.id, 'customInputs', { direction: [event.target.value] })} />
    </label>
    <p className="start-configuration-hint">词根复查间隔：30 天。同类商品不统一禁查。</p>
  </section>;
}
