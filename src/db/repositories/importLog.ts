import { getDb } from '../client';
import { uuid } from '../../lib/uuid';

export type ImportLogStatus = 'imported' | 'duplicate' | 'skipped' | 'failed';

export interface ImportLogRow {
  id: string;
  file_name: string;
  source_uri: string | null;
  status: ImportLogStatus;
  reason: string | null;
  created_at: string;
}

/** Local-only diagnostics for import runs (plan 4.8 / 5.1.1). Never synced. */
export const importLog = {
  async add(input: {
    fileName: string;
    sourceUri?: string;
    status: ImportLogStatus;
    reason?: string;
  }): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO import_log (id, file_name, source_uri, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), input.fileName, input.sourceUri ?? null, input.status, input.reason ?? null, now]
    );
    // Prune to the latest ~200 rows so the table stays small.
    await db.runAsync(
      `DELETE FROM import_log WHERE id NOT IN (
         SELECT id FROM import_log ORDER BY created_at DESC LIMIT 200
       )`
    );
  },
};
