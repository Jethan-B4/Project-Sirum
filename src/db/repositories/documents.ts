import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../client';
import { FINISHED_THRESHOLD, type DocumentFormat, type ReadingStatus } from '../../lib/settingsKeys';

export interface DocumentRow {
  id: string;
  format: 'epub' | 'txt' | 'pdf';
  title: string;
  author: string | null;
  local_uri: string | null;
  text_dir: string | null;
  cover_uri: string | null;
  cover_width: number | null;   // LOCAL ONLY (migration 003)
  cover_height: number | null;  // LOCAL ONLY
  content_hash: string;
  size_bytes: number | null;
  encoding: string | null;
  normalization_version: number;
  chapter_count: number;
  char_count: number | null;
  storage_path: string | null;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
  server_updated_at: string | null;
  sync_error: string | null;
}

/** A document joined with its synced reading progress (for library/history display). */
export interface LibraryDocument extends DocumentRow {
  /** Book-wide progress 0–1, or null when the book has never been opened. */
  percent: number | null;
  last_read_at: string | null;
}

export interface HistoryDocument extends LibraryDocument {
  chapter_index: number;
  chapter_title: string | null;
  last_read_at: string;
}

export type DocumentInput = Omit<
  DocumentRow,
  'created_at' | 'updated_at' | 'deleted_at' | 'dirty' | 'server_updated_at' | 'sync_error'
>;

export interface ListDocumentsOptions {
  search?: string;
  orderMode?: 'recent' | 'fixed';
  sort?: 'title' | 'author' | 'added' | 'lastRead' | 'progress';
  sortDirection?: 'asc' | 'desc';
  formats?: DocumentFormat[];
  status?: ReadingStatus[];
}

const FORMAT_VALUES: DocumentFormat[] = ['epub', 'txt', 'pdf'];

export const documents = {
  /**
   * Library listing. Always LEFT JOINs reading_progress so each row carries the
   * book-wide `percent` and `last_read_at` used for display, sorting, and filters.
   * Ordering follows `library.orderMode`: 'recent' sorts by the latest of
   * last_opened_at / last_read_at / created_at; 'fixed' uses the chosen sort.
   */
  async list(opts?: ListDocumentsOptions): Promise<LibraryDocument[]> {
    const db = await getDb();
    const conditions: string[] = ['d.deleted_at IS NULL'];
    const params: (string | number)[] = [];

    if (opts?.search) {
      conditions.push('(d.title LIKE ? OR d.author LIKE ?)');
      params.push(`%${opts.search}%`, `%${opts.search}%`);
    }

    const formats = (opts?.formats ?? []).filter((f) => FORMAT_VALUES.includes(f));
    if (formats.length > 0) {
      conditions.push(`d.format IN (${formats.map(() => '?').join(',')})`);
      params.push(...formats);
    }

    const status = opts?.status ?? [];
    if (status.length > 0) {
      const statusClauses: string[] = [];
      for (const s of status) {
        if (s === 'unread') {
          statusClauses.push('p.document_id IS NULL');
        } else if (s === 'finished') {
          statusClauses.push(`COALESCE(p.percent, 0) >= ${FINISHED_THRESHOLD}`);
        } else {
          // 'inProgress': a progress row exists but the book is not finished.
          statusClauses.push('p.document_id IS NOT NULL AND COALESCE(p.percent, 0) < ?');
          params.push(FINISHED_THRESHOLD);
        }
      }
      conditions.push(`(${statusClauses.join(' OR ')})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let orderBy: string;
    if (opts?.orderMode === 'recent') {
      // Recency = latest of device-local last_opened_at, synced last_read_at, created_at.
      // ISO 8601 UTC strings compare correctly as text.
      orderBy =
        'ORDER BY MAX(COALESCE(d.last_opened_at, \'\'), COALESCE(p.last_read_at, \'\'), d.created_at) DESC';
    } else {
      const dir = opts?.sortDirection === 'asc' ? 'ASC' : 'DESC';
      const colMap: Record<NonNullable<ListDocumentsOptions['sort']>, string> = {
        title: 'd.title COLLATE NOCASE',
        author: 'COALESCE(d.author, \'\') COLLATE NOCASE',
        added: 'd.created_at',
        lastRead: 'COALESCE(p.last_read_at, \'\')',
        progress: 'COALESCE(p.percent, 0)',
      };
      orderBy = `ORDER BY ${colMap[opts?.sort ?? 'added']} ${dir}`;
    }

    return db.getAllAsync<LibraryDocument>(
      `SELECT d.*,
              p.percent       AS percent,
              p.last_read_at  AS last_read_at
       FROM documents d
       LEFT JOIN reading_progress p
         ON p.document_id = d.id AND p.deleted_at IS NULL
       ${where}
       ${orderBy}`,
      params
    );
  },

  async formatCounts() {
    const db = await getDb();
    const rows = await db.getAllAsync<{ format: DocumentFormat; total: number }>(
      'SELECT format, COUNT(*) AS total FROM documents WHERE deleted_at IS NULL GROUP BY format'
    );
    const counts = { all: 0, epub: 0, txt: 0, pdf: 0 };
    for (const row of rows) {
      counts[row.format] = row.total;
      counts.all += row.total;
    }
    return counts;
  },

  async listHistory(): Promise<HistoryDocument[]> {
    const db = await getDb();
    return db.getAllAsync<HistoryDocument>(
      `SELECT d.*, p.percent, p.last_read_at, p.chapter_index, c.title AS chapter_title
       FROM reading_progress p
       JOIN documents d ON d.id = p.document_id
       LEFT JOIN document_chapters c
         ON c.document_id = d.id AND c.chapter_index = p.chapter_index
       WHERE p.deleted_at IS NULL AND d.deleted_at IS NULL
       ORDER BY p.last_read_at DESC, d.id ASC`
    );
  },

  async getById(id: string): Promise<DocumentRow | null> {
    const db = await getDb();
    return db.getFirstAsync<DocumentRow>(
      'SELECT * FROM documents WHERE id = ?',
      [id]
    );
  },

  async getByHash(hash: string): Promise<DocumentRow | null> {
    const db = await getDb();
    return db.getFirstAsync<DocumentRow>(
      'SELECT * FROM documents WHERE content_hash = ? AND deleted_at IS NULL',
      [hash]
    );
  },

  async create(input: DocumentInput, transaction?: SQLiteDatabase): Promise<void> {
    const db = transaction ?? await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO documents (
        id, format, title, author, local_uri, text_dir, cover_uri, cover_width,
        cover_height, content_hash,
        size_bytes, encoding, normalization_version, chapter_count, char_count,
        storage_path, last_opened_at, created_at, updated_at, deleted_at,
        dirty, server_updated_at, sync_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, NULL)`,
      [
        input.id,
        input.format,
        input.title,
        input.author ?? null,
        input.local_uri ?? null,
        input.text_dir ?? null,
        input.cover_uri ?? null,
        input.cover_width ?? null,
        input.cover_height ?? null,
        input.content_hash,
        input.size_bytes ?? null,
        input.encoding ?? null,
        input.normalization_version,
        input.chapter_count,
        input.char_count ?? null,
        input.storage_path ?? null,
        input.last_opened_at ?? null,
        now,
        now,
      ]
    );
  },

  async updateLocalCover(id: string, uri: string, width: number, height: number) {
    const db = await getDb();
    await db.runAsync(
      'UPDATE documents SET cover_uri = ?, cover_width = ?, cover_height = ? WHERE id = ?',
      [uri, width, height, id]
    );
  },

  async update(id: string, patch: Partial<DocumentRow>): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = ?', 'dirty = 1'];
    const params: (string | number | null)[] = [now];

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'updated_at' || key === 'dirty' || key === 'id') continue;
      setClauses.push(`${key} = ?`);
      params.push(value as string | number | null);
    }

    params.push(id);

    await db.runAsync(
      `UPDATE documents SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
  },

  async softDelete(id: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE documents SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [now, now, id]
    );
  },

  /**
   * Records that this device opened the book. Writes ONLY the local-only
   * `last_opened_at` column — never `updated_at`, never `dirty` — so opening a
   * book does not trigger a sync push or overwrite synced metadata.
   */
  async touchOpened(id: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE documents SET last_opened_at = ? WHERE id = ?`,
      [now, id]
    );
  },
};
