import { getDb } from '../client';
import { uuid } from '../../lib/uuid';

export interface BookmarkRow {
  id: string;
  document_id: string;
  char_offset: number;
  chapter_index: number;
  chapter_char_offset: number;
  label: string | null;
  snippet: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
  server_updated_at: string | null;
  sync_error: string | null;
}

export const bookmarks = {
  async list(documentId: string): Promise<BookmarkRow[]> {
    const db = await getDb();
    return db.getAllAsync<BookmarkRow>(
      `SELECT * FROM bookmarks WHERE document_id = ? AND deleted_at IS NULL ORDER BY char_offset ASC`,
      [documentId]
    );
  },

  async create(
    input: Omit<BookmarkRow, 'created_at' | 'updated_at' | 'deleted_at' | 'dirty' | 'server_updated_at' | 'sync_error'>
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const id = input.id || uuid();
    await db.runAsync(
      `INSERT INTO bookmarks (
        id, document_id, char_offset, chapter_index, chapter_char_offset,
        label, snippet, created_at, updated_at, deleted_at, dirty,
        server_updated_at, sync_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, NULL)`,
      [
        id,
        input.document_id,
        input.char_offset,
        input.chapter_index,
        input.chapter_char_offset,
        input.label ?? null,
        input.snippet ?? null,
        now,
        now,
      ]
    );
  },

  async update(id: string, patch: Partial<Pick<BookmarkRow, 'label' | 'snippet'>>): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = ?', 'dirty = 1'];
    const params: (string | null)[] = [now];

    if ('label' in patch) {
      setClauses.push('label = ?');
      params.push(patch.label ?? null);
    }
    if ('snippet' in patch) {
      setClauses.push('snippet = ?');
      params.push(patch.snippet ?? null);
    }

    params.push(id);

    await db.runAsync(
      `UPDATE bookmarks SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
  },

  async softDelete(id: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE bookmarks SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [now, now, id]
    );
  },

  async restore(id: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE bookmarks SET deleted_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?`,
      [now, id]
    );
  },
};
