import { getDb } from '../client';
import { uuid } from '../../lib/uuid';

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

  async create(input: Pick<HighlightRow, 'document_id' | 'start_offset' | 'end_offset' | 'chapter_index' | 'color' | 'note'>): Promise<string> {
    if (!input.color?.trim() || input.color === 'u:') {
      throw new Error('Highlights require a color.');
    }
    const db = await getDb();
    const now = new Date().toISOString();
    const id = uuid();
    await db.runAsync(
      `INSERT INTO highlights (
        id, document_id, start_offset, end_offset, chapter_index, color, note,
        created_at, updated_at, deleted_at, dirty, server_updated_at, sync_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, NULL)`,
      [id, input.document_id, input.start_offset, input.end_offset, input.chapter_index,
        input.color, input.note, now, now]
    );
    return id;
  },

  async update(id: string, patch: Partial<Pick<HighlightRow, 'color' | 'note'>>): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const setClauses = ['updated_at = ?', 'dirty = 1'];
    const params: (string | null)[] = [now];
    if ('color' in patch) {
      if (!patch.color?.trim() || patch.color === 'u:') {
        throw new Error('Highlights require a color.');
      }
      setClauses.push('color = ?');
      params.push(patch.color);
    }
    if ('note' in patch) {
      setClauses.push('note = ?');
      params.push(patch.note ?? null);
    }
    params.push(id);
    await db.runAsync(`UPDATE highlights SET ${setClauses.join(', ')} WHERE id = ?`, params);
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
