'use strict';

const EventEmitter = require('events');
const eventEmitter = new EventEmitter();

// 限制事件监听器的最大数量
eventEmitter.setMaxListeners(200);

/**
 * 发送工作流事件
 * @param {string} runId 运行 ID
 * @param {string} eventName 事件名称，例如 'status_change' | 'node_change' | 'log'
 * @param {object} payload 携带的数据
 */
function emitRunEvent(runId, eventName, payload) {
  eventEmitter.emit(`run:${runId}`, {
    runId,
    event: eventName,
    payload,
    timestamp: new Date().toISOString()
  });

  // 同时也发送全局事件，用于监控
  eventEmitter.emit('global_run_event', {
    runId,
    event: eventName,
    payload,
    timestamp: new Date().toISOString()
  });
}

/**
 * 订阅指定运行的事件
 * @param {string} runId 运行 ID
 * @param {function} callback 回调函数 (eventData) => {}
 * @returns {function} 取消订阅的函数
 */
function subscribeRun(runId, callback) {
  const handler = (data) => callback(data);
  eventEmitter.on(`run:${runId}`, handler);
  return () => {
    eventEmitter.off(`run:${runId}`, handler);
  };
}

/**
 * 订阅全局工作流事件
 * @param {function} callback 回调函数
 * @returns {function} 取消订阅的函数
 */
function subscribeGlobal(callback) {
  const handler = (data) => callback(data);
  eventEmitter.on('global_run_event', handler);
  return () => {
    eventEmitter.off('global_run_event', handler);
  };
}

module.exports = {
  emitRunEvent,
  subscribeRun,
  subscribeGlobal
};
