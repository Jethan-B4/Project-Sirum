import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../client';

export interface ChapterRow {
  document_id: string;
  chapter_index: number;
  title: string | null;
  source_href: string | null;
  start_offset: number;
  char_count: number;
}

export const chapters = {
  async list(documentId: string): Promise<ChapterRow[]> {
    const db = await getDb();
    return db.getAllAsync<ChapterRow>(
      'SELECT * FROM document_chapters WHERE document_id = ? ORDER BY chapter_index ASC',
      [documentId]
    );
  },

  async hasIndex(documentId: string): Promise<boolean> {
    const db = await getDb();
    return !!await db.getFirstAsync('SELECT 1 FROM document_chapters WHERE document_id = ? LIMIT 1', [documentId]);
  },

  /** Replace all chapters for a document in a single transaction. */
  async replaceForDocument(
    documentId: string,
    rows: Omit<ChapterRow, 'document_id'>[],
    transaction?: SQLiteDatabase
  ): Promise<void> {
    const replace = async (db: SQLiteDatabase) => {
      await db.runAsync('DELETE FROM document_chapters WHERE document_id = ?', [documentId]);

      for (const row of rows) {
        await db.runAsync(
          `INSERT INTO document_chapters (document_id, chapter_index, title, source_href, start_offset, char_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            documentId,
            row.chapter_index,
            row.title ?? null,
            row.source_href ?? null,
            row.start_offset,
            row.char_count,
          ]
        );
      }
    };
    if (transaction) return replace(transaction);
    const db = await getDb();
    await db.withExclusiveTransactionAsync(replace);
  },
};
