import { Play, Settings2 } from 'lucide-react';
import { SELECTION_MODES, selectionSourceSummary } from '../../selection-modes.js';

/**
 * 选品开始节点上的模式与启动操作。
 * @param {object} props 节点数据。
 * @returns {import('react').JSX.Element} 节点操作区。
 */
export function SelectionStartControls({ data }) {
  const locked = Boolean(data.workflowRunId || data.workflowReadOnly || ['pending', 'running', 'resuming', 'retrying'].includes(data.workflowRunStatus));
  const selected = SELECTION_MODES.find(item => item.mode === data.selectionMode) || SELECTION_MODES[0];
  return <div className="selection-start-controls nodrag nopan" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <fieldset className="selection-mode-switch" disabled={locked}>
      <legend>选词模式</legend>
      {SELECTION_MODES.map(item => <label key={item.mode} className={selected.mode === item.mode ? 'is-selected' : ''}>
        <input type="radio" name="selection-mode" value={item.mode} checked={selected.mode === item.mode}
          onChange={() => data.onUpdate?.('selectionMode', item.mode)} />
        <span>{item.label}</span>
      </label>)}
    </fieldset>
    <p className="selection-source-summary">{selectionSourceSummary(data)}</p>
    <div className="selection-start-actions">
      <button type="button" className="node-secondary-button" onClick={() => data.onAction?.('manual-input')}><Settings2 size={13} />{locked ? '查看配置' : selected.action}</button>
      {!locked && <button type="button" className="node-primary-button" onClick={() => data.onAction?.('launch-selection')}><Play size={13} />启动流水线</button>}
    </div>
  </div>;
}
