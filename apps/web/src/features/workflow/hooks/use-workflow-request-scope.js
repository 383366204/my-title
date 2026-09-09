import { useLayoutEffect, useMemo } from 'react';
import { createWorkflowRequestScope } from '../workflow-request-scope.js';

/**
 * 在切换运行或卸载时使旧请求失效，兼容 StrictMode 的 effect 重放。
 * @param {string|null} viewKey 当前运行或未启动模板的视图标识。
 * @returns {object} 仅属于当前运行视图的请求作用域。
 */
export function useWorkflowRequestScope(viewKey) {
  const scope = useMemo(() => createWorkflowRequestScope(), [viewKey]);
  useLayoutEffect(() => {
    scope.activate();
    return () => scope.close();
  }, [scope]);
  return scope;
}
