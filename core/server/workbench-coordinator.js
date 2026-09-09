'use strict';

/**
 * 为同一服务实例中的 CLI、流水线和旧单步骤入口维护单任务占用。
 * @returns {object} 只读当前任务、预占、执行与按所有者释放的方法。
 */
function createWorkbenchCoordinator() {
  let current = null;
  const coordinator = {
    get current() { return current; },
    tryAcquire(task) {
      if (current) return null;
      if (!task || typeof task !== 'object') throw new TypeError('Task metadata is required');
      current = task;
      return task;
    },
    release(task) {
      if (!task || current !== task) return false;
      current = null;
      return true;
    },
    runReserved(task, execute) {
      if (current !== task || !task) throw new Error('Task reservation is no longer active');
      try {
        const promise = Promise.resolve(execute());
        task.promise = promise;
        promise.then(() => coordinator.release(task), () => coordinator.release(task));
        return promise;
      } catch (error) {
        coordinator.release(task);
        throw error;
      }
    },
    run(task, execute) {
      if (!coordinator.tryAcquire(task)) {
        throw Object.assign(new Error('已有工作流正在运行，请等待完成后再继续。'), { code: 'WORKFLOW_BUSY' });
      }
      return coordinator.runReserved(task, execute);
    }
  };
  return coordinator;
}

module.exports = { createWorkbenchCoordinator };
