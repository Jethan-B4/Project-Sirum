import { getDb } from '../client';
import type { SettingKey, SettingValues } from '../../lib/settingsKeys';
import { serializeSetting, parseSetting } from '../../lib/settingsKeys';

export const settings = {
  async get<K extends SettingKey>(key: K): Promise<SettingValues[K] | undefined> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    );
    if (!row) return undefined;
    return parseSetting(key, row.value);
  },

  async set<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const serialized = serializeSetting(key, value);
    await db.runAsync(
      `INSERT INTO settings (key, value, updated_at, dirty)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, dirty = 1`,
      [key, serialized, now]
    );
  },

  async getDirtyRows(): Promise<Array<{ key: string; value: string; updated_at: string }>> {
    const db = await getDb();
    return db.getAllAsync<{ key: string; value: string; updated_at: string }>(
      'SELECT key, value, updated_at FROM settings WHERE dirty = 1'
    );
  },
};
