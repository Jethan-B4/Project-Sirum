import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { settings } from '@/db/repositories';
import {
  parseSetting,
  SettingDefaults,
  type SettingKey,
  type SettingValues,
} from '@/lib/settingsKeys';
import { logger } from '@/lib/logger';

interface SettingsContextValue {
  /** False until the initial load from SQLite completes. */
  ready: boolean;
  /** True when the user has actually stored a value for this key (drives ask-once prompts). */
  has(key: string): boolean;
  /** Resolved value: stored choice, or the in-memory default when unset. */
  get<K extends SettingKey>(key: K): SettingValues[K];
  /** Persist a typed setting value. */
  set<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void>;
  /** Read + parse a JSON value for an arbitrary key (e.g. `reader.book.<id>`). */
  getJson<T>(key: string): T | undefined;
  /** Persist a JSON-serializable value for an arbitrary key. */
  setJson(key: string, value: unknown): Promise<void>;
  /** Delete a stored key entirely (e.g. resetting a per-book override). */
  remove(key: string): Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settings
      .listAll()
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of rows) map[row.key] = row.value;
        setRaw(map);
        setReady(true);
      })
      .catch((err) => {
        logger.error('Failed to load settings', err);
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (key: string, serialized: string) => {
    await settings.setRaw(key, serialized);
    setRaw((prev) => ({ ...prev, [key]: serialized }));
  }, []);

  // Resolved values are memoized so object-valued settings (e.g. library.filters,
  // reader.style) keep a stable identity between renders — consumers can safely
  // use them in hook dependency arrays.
  const resolved = useMemo(() => {
    const out = {} as SettingValues;
    const bag = out as unknown as Record<string, unknown>;
    for (const key of Object.keys(SettingDefaults) as SettingKey[]) {
      bag[key] = parseSetting(key, raw[key]) ?? SettingDefaults[key];
    }
    return out;
  }, [raw]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ready,
      has: (key) => raw[key] !== undefined,
      get: <K extends SettingKey>(key: K): SettingValues[K] => resolved[key] as SettingValues[K],
      set: async <K extends SettingKey>(key: K, v: SettingValues[K]) => {
        await persist(key, JSON.stringify(v));
      },
      getJson: <T,>(key: string): T | undefined => {
        const s = raw[key];
        if (s === undefined) return undefined;
        try {
          return JSON.parse(s) as T;
        } catch {
          return undefined;
        }
      },
      setJson: async (key, v) => {
        await persist(key, JSON.stringify(v));
      },
      remove: async (key) => {
        await settings.remove(key);
        setRaw((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      },
    }),
    [raw, ready, persist, resolved]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}

/** Convenience: resolve a setting with its default, re-rendering on change. */
export function useSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return useSettings().get(key);
}
