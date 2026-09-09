/**
 * 隔离一次运行视图中的异步请求，同通道防重，关闭后丢弃迟到响应。
 * @returns {object} 请求通道与生命周期控制。
 */
export function createWorkflowRequestScope() {
  let active = true;
  const pending = new Map();
  return {
    activate() { active = true; },
    close() { active = false; pending.clear(); },
    begin(channel) {
      if (!active || pending.has(channel)) return null;
      const token = {};
      pending.set(channel, token);
      const isCurrent = () => active && pending.get(channel) === token;
      return {
        isCurrent,
        finish() {
          if (!isCurrent()) return false;
          pending.delete(channel);
          return true;
        }
      };
    }
  };
}
