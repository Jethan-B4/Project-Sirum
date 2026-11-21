import { getDb } from '../client';

export interface HighlightRow {
  id: string;
  document_id: string;
  start_offset: number;
  end_offset: number;
  chapter_index: number;
  color: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
  server_updated_at: string | null;
  sync_error: string | null;
}

export const highlights = {
  async list(documentId: string): Promise<HighlightRow[]> {
    const db = await getDb();
    return db.getAllAsync<HighlightRow>(
      `SELECT * FROM highlights
       WHERE document_id = ? AND deleted_at IS NULL
       ORDER BY start_offset ASC`,
      [documentId]
    );
  },

  async softDelete(id: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE highlights SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [now, now, id]
    );
  },
};
