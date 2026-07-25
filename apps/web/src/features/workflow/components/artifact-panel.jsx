import { RefreshCw } from 'lucide-react';

import { getWorkflowArtifactView, summarizeWorkflowArtifact } from '../../../workflow-ui.js';

export function ArtifactPanel({ state }) {
  const artifact = state.artifact;
  const view = getWorkflowArtifactView(artifact, state.nodeId);
  const businessRows = view.kind === 'business-list' || view.kind === 'candidate-list';

  return (
    <div className="workflow-artifact-panel">
      <div className="workflow-artifact-head">
        <span>{view.title || '节点产物'}</span>
        {artifact && <b>{summarizeWorkflowArtifact(artifact)}</b>}
      </div>
      {state.status === 'loading' && (
        <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载节点产物...</div>
      )}
      {state.status === 'error' && (
        <div className="artifact-error">{state.error || '节点产物加载失败'}</div>
      )}
      {state.status === 'empty' && (
        <div className="artifact-empty">{state.error || view.emptyText}</div>
      )}
      {state.status === 'ready' && artifact && businessRows && (
        <div className="artifact-business-list">
          {view.rows.length === 0 ? (
            <div className="artifact-empty">{view.emptyText}</div>
          ) : view.rows.map((item, index) => (
            <div className="artifact-business-row" key={`${item.title}-${index}`}>
              <strong>{item.title}</strong>
              {item.meta && <span>{item.meta}</span>}
              {Array.isArray(item.metrics) && item.metrics.length > 0 && (
                <div className="artifact-business-metrics">
                  {item.metrics.map((metric) => <em key={metric}>{metric}</em>)}
                </div>
              )}
              {item.description && <p>{item.description}</p>}
            </div>
          ))}
        </div>
      )}
      {state.status === 'ready' && artifact && view.kind === 'json-list' && (
        <div className="artifact-list">
          {view.rows.length === 0 ? (
            <div className="artifact-empty">{view.emptyText}</div>
          ) : view.rows.map((item, index) => (
            <pre key={index}>{JSON.stringify(item, null, 2)}</pre>
          ))}
        </div>
      )}
      {state.status === 'ready' && artifact && (view.kind === 'text' || view.kind === 'json-text') && (
        <pre className="artifact-text">
          {view.text || view.emptyText}
        </pre>
      )}
    </div>
  );
}
