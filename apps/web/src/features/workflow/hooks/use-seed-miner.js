import { useCallback, useEffect, useState } from 'react';

import { mineKeywordRoots } from '../../../api/mining-api.js';
import {
  addSeed,
  deleteSeed,
  listSeeds,
  setSeedStatus,
  toggleSeed
} from '../../../api/seed-api.js';
import { MINER_TABS } from '../workflow-data.js';

/**
 * 种子池管理 Hook
 * @param {object} [options] - 配置项
 * @param {boolean} [options.active] - 种子池是否处于激活状态
 * @returns {object} 种子池状态与操作函数
 */
export function useSeedPool({ active } = {}) {
  const [seedRows, setSeedRows] = useState([]);
  const [seedDraft, setSeedDraft] = useState({ keyword: '', category: '', priority: 5, type: 'manual' });
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');

  const loadSeeds = useCallback(async () => {
    setSeedLoading(true);
    setSeedMessage('');
    try {
      const rows = await listSeeds();
      setSeedRows(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setSeedMessage(error.message);
    } finally {
      setSeedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) loadSeeds();
  }, [active, loadSeeds]);

  const addSeedToPool = async () => {
    const keyword = String(seedDraft.keyword || '').trim();
    if (!keyword) {
      setSeedMessage('请先输入种子词。');
      return;
    }
    setSeedLoading(true);
    setSeedMessage('');
    try {
      await addSeed({ ...seedDraft, keyword });
      setSeedDraft((current) => ({ ...current, keyword: '' }));
      setSeedMessage('已加入种子池。');
      await loadSeeds();
    } catch (error) {
      setSeedMessage(error.message);
    } finally {
      setSeedLoading(false);
    }
  };

  const toggleSeedInPool = async (keyword) => {
    setSeedMessage('');
    try {
      await toggleSeed(keyword);
      await loadSeeds();
    } catch (error) {
      setSeedMessage(error.message);
    }
  };

  const updateSeedStatus = async (keyword, status) => {
    setSeedMessage('');
    try {
      await setSeedStatus(keyword, status);
      const statusLabel = { active: '活跃', observing: '观察', explore: '探索', cooling: '冷却' }[status] || status;
      setSeedMessage(`已将“${keyword}”设为${statusLabel}。`);
      await loadSeeds();
    } catch (error) {
      setSeedMessage(error.message);
    }
  };

  const deleteSeedFromPool = async (keyword) => {
    if (!window.confirm(`确认删除种子词「${keyword}」？`)) return;
    setSeedMessage('');
    try {
      await deleteSeed(keyword);
      await loadSeeds();
    } catch (error) {
      setSeedMessage(error.message);
    }
  };

  return {
    seedRows,
    seedDraft,
    setSeedDraft,
    seedLoading,
    seedMessage,
    setSeedMessage,
    loadSeeds,
    addSeed: addSeedToPool,
    toggleSeed: toggleSeedInPool,
    setSeedStatus: updateSeedStatus,
    deleteSeed: deleteSeedFromPool
  };
}

/**
 * 词根挖掘 Hook
 * @param {object} [options] - 配置项
 * @param {Function} [options.setSeedMessage] - 设置消息提示的回调函数
 * @returns {object} 词根挖掘状态与操作函数
 */
export function useRootMiner({ setSeedMessage } = {}) {
  const [minerTab, setMinerTab] = useState('peer');
  const [minerInput, setMinerInput] = useState('');
  const [minerResults, setMinerResults] = useState([]);
  const [minerBusy, setMinerBusy] = useState(false);

  const runRootMiner = async () => {
    const tab = MINER_TABS.find((item) => item.id === minerTab) || MINER_TABS[0];
    if (tab.needsInput && !minerInput.trim()) return;
    setMinerBusy(true);
    setMinerResults([]);
    if (typeof setSeedMessage === 'function') setSeedMessage('');
    try {
      const data = await mineKeywordRoots(tab.endpoint, tab.needsInput ? minerInput.trim() : '');
      setMinerResults(Array.isArray(data) ? data : []);
    } catch (error) {
      if (typeof setSeedMessage === 'function') setSeedMessage(`词根发现失败：${error.message}`);
    } finally {
      setMinerBusy(false);
    }
  };

  return {
    minerTab,
    setMinerTab,
    minerInput,
    setMinerInput,
    minerResults,
    minerBusy,
    runRootMiner
  };
}

/**
 * 种子池与词根挖掘兼容组合 Hook
 * @param {object} [options] - 配置项
 * @param {boolean} [options.active] - 是否处于激活状态
 * @returns {object} 包含种子池与词根挖掘的全量状态与操作函数
 */
export function useSeedMiner({ active } = {}) {
  const seedPool = useSeedPool({ active });
  const rootMiner = useRootMiner({ setSeedMessage: seedPool.setSeedMessage });

  return {
    seedRows: seedPool.seedRows,
    seedDraft: seedPool.seedDraft,
    setSeedDraft: seedPool.setSeedDraft,
    seedLoading: seedPool.seedLoading,
    seedMessage: seedPool.seedMessage,
    loadSeeds: seedPool.loadSeeds,
    addSeed: seedPool.addSeed,
    toggleSeed: seedPool.toggleSeed,
    setSeedStatus: seedPool.setSeedStatus,
    deleteSeed: seedPool.deleteSeed,
    minerTab: rootMiner.minerTab,
    setMinerTab: rootMiner.setMinerTab,
    minerInput: rootMiner.minerInput,
    setMinerInput: rootMiner.setMinerInput,
    minerResults: rootMiner.minerResults,
    minerBusy: rootMiner.minerBusy,
    runRootMiner: rootMiner.runRootMiner
  };
}
