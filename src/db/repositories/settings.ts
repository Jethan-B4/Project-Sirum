import { getDb } from '../client';
import type { SettingKey, SettingValues } from '../../lib/settingsKeys';
import { isDeviceLocalKey, serializeSetting, parseSetting } from '../../lib/settingsKeys';

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export const settings = {
  /** All stored rows (raw JSON text values). */
  async listAll(): Promise<SettingRow[]> {
    const db = await getDb();
    return db.getAllAsync<SettingRow>('SELECT key, value, updated_at FROM settings');
  },

  async getRaw(key: string): Promise<string | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  },

  /**
   * Upsert a raw (already JSON-encoded) value.
   * `device.*` keys are device-local: they are written with dirty = 0 so they never sync.
   */
  async setRaw(key: string, serialized: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const dirty = isDeviceLocalKey(key) ? 0 : 1;
    await db.runAsync(
      `INSERT INTO settings (key, value, updated_at, dirty)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         dirty = excluded.dirty`,
      [key, serialized, now, dirty]
    );
  },

  async remove(key: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
  },

  async get<K extends SettingKey>(key: K): Promise<SettingValues[K] | undefined> {
    return parseSetting(key, await this.getRaw(key));
  },

  async set<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void> {
    await this.setRaw(key, serializeSetting(key, value));
  },

  async getDirtyRows(): Promise<{ key: string; value: string; updated_at: string }[]> {
    const db = await getDb();
    return db.getAllAsync<{ key: string; value: string; updated_at: string }>(
      'SELECT key, value, updated_at FROM settings WHERE dirty = 1'
    );
  },
};
