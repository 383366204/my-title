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

export function useSeedMiner({ active }) {
  const [seedRows, setSeedRows] = useState([]);
  const [seedDraft, setSeedDraft] = useState({ keyword: '', category: '', priority: 5, type: 'manual' });
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [minerTab, setMinerTab] = useState('peer');
  const [minerInput, setMinerInput] = useState('');
  const [minerResults, setMinerResults] = useState([]);
  const [minerBusy, setMinerBusy] = useState(false);

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

  const runRootMiner = async () => {
    const tab = MINER_TABS.find((item) => item.id === minerTab) || MINER_TABS[0];
    if (tab.needsInput && !minerInput.trim()) return;
    setMinerBusy(true);
    setMinerResults([]);
    setSeedMessage('');
    try {
      const data = await mineKeywordRoots(tab.endpoint, tab.needsInput ? minerInput.trim() : '');
      setMinerResults(Array.isArray(data) ? data : []);
    } catch (error) {
      setSeedMessage(`词根发现失败：${error.message}`);
    } finally {
      setMinerBusy(false);
    }
  };

  return {
    seedRows,
    seedDraft,
    setSeedDraft,
    seedLoading,
    seedMessage,
    loadSeeds,
    addSeed: addSeedToPool,
    toggleSeed: toggleSeedInPool,
    setSeedStatus: updateSeedStatus,
    deleteSeed: deleteSeedFromPool,
    minerTab,
    setMinerTab,
    minerInput,
    setMinerInput,
    minerResults,
    minerBusy,
    runRootMiner
  };
}
