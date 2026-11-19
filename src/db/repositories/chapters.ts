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

  /** Replace all chapters for a document in a single transaction. */
  async replaceForDocument(
    documentId: string,
    rows: Omit<ChapterRow, 'document_id'>[]
  ): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
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
    });
  },
};
