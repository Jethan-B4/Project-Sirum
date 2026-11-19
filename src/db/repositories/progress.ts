import { getDb } from '../client';

export interface ProgressRow {
  document_id: string;
  char_offset: number;
  chapter_index: number;
  chapter_char_offset: number;
  percent: number;
  snippet: string | null;
  last_read_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
  server_updated_at: string | null;
  sync_error: string | null;
}

export type ProgressInput = {
  charOffset: number;
  chapterIndex: number;
  chapterCharOffset: number;
  percent: number;
  snippet?: string;
};

export const progress = {
  async get(documentId: string): Promise<ProgressRow | null> {
    const db = await getDb();
    return db.getFirstAsync<ProgressRow>(
      'SELECT * FROM reading_progress WHERE document_id = ?',
      [documentId]
    );
  },

  async upsert(documentId: string, input: ProgressInput): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT OR REPLACE INTO reading_progress (
        document_id, char_offset, chapter_index, chapter_char_offset, percent,
        snippet, last_read_at, created_at, updated_at, deleted_at, dirty,
        server_updated_at, sync_error
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        COALESCE((SELECT created_at FROM reading_progress WHERE document_id = ?), ?),
        ?, NULL, 1, NULL, NULL
      )`,
      [
        documentId,
        input.charOffset,
        input.chapterIndex,
        input.chapterCharOffset,
        input.percent,
        input.snippet ?? null,
        now,
        documentId,
        now,
        now,
      ]
    );
  },

  async softDelete(documentId: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE reading_progress SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE document_id = ?`,
      [now, now, documentId]
    );
  },
};
