import { getDb } from '../client';

export interface DocumentRow {
  id: string;
  format: 'epub' | 'txt' | 'pdf';
  title: string;
  author: string | null;
  local_uri: string | null;
  text_dir: string | null;
  cover_uri: string | null;
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

export type DocumentInput = Omit<
  DocumentRow,
  'created_at' | 'updated_at' | 'deleted_at' | 'dirty' | 'server_updated_at' | 'sync_error'
>;

export const documents = {
  async list(opts?: {
    search?: string;
    sort?: string;
    sortDirection?: 'asc' | 'desc';
    orderMode?: 'recent' | 'fixed';
  }): Promise<DocumentRow[]> {
    const db = await getDb();
    const conditions: string[] = ["deleted_at IS NULL"];
    const params: (string | number)[] = [];

    if (opts?.search) {
      conditions.push("(title LIKE ? OR author LIKE ?)");
      params.push(`%${opts.search}%`, `%${opts.search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let orderBy: string;
    if (opts?.orderMode === 'recent') {
      orderBy = 'ORDER BY COALESCE(last_opened_at, created_at) DESC';
    } else {
      const col = opts?.sort ?? 'created_at';
      const dir = opts?.sortDirection ?? 'desc';
      const safeDir = dir === 'asc' ? 'ASC' : 'DESC';
      // Map friendly sort names to column names
      const colMap: Record<string, string> = {
        title: 'title',
        author: 'author',
        added: 'created_at',
        lastRead: 'last_opened_at',
        progress: 'char_count',
      };
      const safeCol = colMap[col] ?? col;
      orderBy = `ORDER BY ${safeCol} ${safeDir}`;
    }

    return db.getAllAsync<DocumentRow>(
      `SELECT * FROM documents ${where} ${orderBy}`,
      params
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

  async create(input: DocumentInput): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO documents (
        id, format, title, author, local_uri, text_dir, cover_uri, content_hash,
        size_bytes, encoding, normalization_version, chapter_count, char_count,
        storage_path, last_opened_at, created_at, updated_at, deleted_at,
        dirty, server_updated_at, sync_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, NULL)`,
      [
        input.id,
        input.format,
        input.title,
        input.author ?? null,
        input.local_uri ?? null,
        input.text_dir ?? null,
        input.cover_uri ?? null,
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

  async touchOpened(id: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE documents SET last_opened_at = ? WHERE id = ?`,
      [now, id]
    );
  },
};
