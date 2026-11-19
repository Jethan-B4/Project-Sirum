import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { migrations } from './migrations';

const DB_NAME = 'reader.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Returns the opened, migrated database. Safe to call from anywhere. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = init().catch((err) => {
      dbPromise = null; // allow a retry on the next call
      throw err;
    });
  }
  return dbPromise;
}

async function init(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // These pragmas must run outside a transaction.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  await ensureDeviceId(db);
  return db;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => m.version > current);

  for (const m of pending) {
    // Each migration and its version bump commit together or not at all.
    await db.withTransactionAsync(async () => {
      await db.execAsync(m.sql);
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
    });
  }
}

async function ensureDeviceId(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO sync_state (key, value) VALUES ('device_id', ?)`,
    [Crypto.randomUUID()]
  );
}
