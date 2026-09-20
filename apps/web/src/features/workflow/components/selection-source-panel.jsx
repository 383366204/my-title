import { useState } from 'react';
import { getWorkflowLaunchBlocker } from '../workflow-launch-params.js';
import { SELECTION_MODES } from '../selection-modes.js';
import { StartConfigurationPanel } from './start-configuration-panel.jsx';

/**
 * 隔离未保存输入；关闭或取消不会修改画布配置。
 * @param {object} props 当前节点、保存与关闭回调。
 * @returns {import('react').JSX.Element} 选词来源表单。
 */
export function SelectionSourcePanel({ node, readOnly, onSave, onClose }) {
  const [draft, setDraft] = useState(() => ({ ...node.data }));
  const [error, setError] = useState('');
  const mode = node.data.selectionMode;
  const save = () => {
    const blocker = getWorkflowLaunchBlocker(mode, [{ ...node, data: draft }]);
    if (blocker) { setError(blocker.error); return; }
    onSave(node.id, draft);
    onClose();
  };
  return <div className="selection-source-panel">
    <div className="selection-source-scroll">
      <StartConfigurationPanel mode={mode} node={{ ...node, data: draft }} readOnly={readOnly}
        modeHint={SELECTION_MODES.find(item => item.mode === mode)?.label}
        onDone={onClose}
        onUpdateField={(_id, field, value) => { setDraft(current => ({ ...current, [field]: value })); setError(''); }} />
    </div>
    <footer className="selection-source-footer">
      {error && <span role="alert">{error}</span>}
      <button type="button" className="node-secondary-button" onClick={onClose}>{readOnly ? '关闭' : '取消'}</button>
      {!readOnly && <button type="button" className="node-primary-button" onClick={save}>保存配置</button>}
    </footer>
  </div>;
}
