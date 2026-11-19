// Local SQLite schema, version 2: formats, chapters, and library recency.
//
// Adds, on top of 001_init:
//   documents.format / chapter_count       synced metadata
//   documents.text_dir / cover_uri         LOCAL ONLY (never pushed)
//   documents.last_opened_at               LOCAL ONLY (never pushed); powers the
//                                          "recently opened first" library order
//   chapter columns on progress/bookmarks/highlights   synced
//   document_chapters                      LOCAL ONLY chapter index (rebuildable
//                                          from the original file)
//
// Rules for the sync code:
//   * Push explicit column lists, never SELECT *, so local-only columns never leave the device.
//   * Writing last_opened_at must NOT set dirty or updated_at (see documents.touchOpened).
//
// Existing rows get safe defaults ('txt', 1 chapter, chapter 0).
// Note: SQLite cannot add a CHECK on format cheaply here; validate it in code
// (the server enforces it with a CHECK constraint).

export const sql = `
ALTER TABLE documents ADD COLUMN format TEXT NOT NULL DEFAULT 'txt';
ALTER TABLE documents ADD COLUMN chapter_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN text_dir TEXT;
ALTER TABLE documents ADD COLUMN cover_uri TEXT;
ALTER TABLE documents ADD COLUMN last_opened_at TEXT;
CREATE INDEX idx_documents_last_opened ON documents (last_opened_at);

ALTER TABLE reading_progress ADD COLUMN chapter_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reading_progress ADD COLUMN chapter_char_offset INTEGER NOT NULL DEFAULT 0;

ALTER TABLE bookmarks ADD COLUMN chapter_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookmarks ADD COLUMN chapter_char_offset INTEGER NOT NULL DEFAULT 0;

ALTER TABLE highlights ADD COLUMN chapter_index INTEGER NOT NULL DEFAULT 0;

-- LOCAL ONLY: chapter index for each document. Never synced; rebuilt from the file.
CREATE TABLE document_chapters (
  document_id   TEXT NOT NULL REFERENCES documents (id),
  chapter_index INTEGER NOT NULL,
  title         TEXT,
  source_href   TEXT,               -- EPUB spine item path, PDF outline target
  start_offset  INTEGER NOT NULL,   -- global offset where this chapter begins (UTF-16 code units)
  char_count    INTEGER NOT NULL,
  PRIMARY KEY (document_id, chapter_index)
);
`;
