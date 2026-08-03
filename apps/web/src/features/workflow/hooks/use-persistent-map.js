import { useCallback, useEffect, useState } from 'react';

const EMPTY_MAP = Object.freeze({});

function browserStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function readPersistentMap(key, storage = browserStorage()) {
  if (!storage || !key) return {};
  try {
    const saved = JSON.parse(storage.getItem(key) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function writePersistentMap(key, value, storage = browserStorage()) {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify(value || {}));
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist a map under a dynamic key without writing the previous key's state.
 * @param {string} key Storage key.
 * @returns {[object, Function]} Current map and React state setter.
 */
export function usePersistentMap(key) {
  const [entry, setEntry] = useState(() => ({ key, value: readPersistentMap(key) }));

  useEffect(() => {
    setEntry((current) => (
      current.key === key ? current : { key, value: readPersistentMap(key) }
    ));
  }, [key]);

  useEffect(() => {
    if (entry.key !== key) return;
    writePersistentMap(key, entry.value);
  }, [entry, key]);

  const setValue = useCallback((nextValue) => {
    setEntry((current) => {
      const currentValue = current.key === key ? current.value : readPersistentMap(key);
      return {
        key,
        value: typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
      };
    });
  }, [key]);

  return [entry.key === key ? entry.value : EMPTY_MAP, setValue];
}
