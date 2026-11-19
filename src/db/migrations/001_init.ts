// Local SQLite schema, version 1.
// Mirrors the Supabase tables, plus local-only sync columns:
//   dirty       1 = row has local changes not yet pushed
//   sync_error  set when the server permanently rejected the row (quarantine)
// Timestamps are ISO 8601 UTC strings (e.g. new Date().toISOString()).

export const sql = `
CREATE TABLE documents (
  id                    TEXT PRIMARY KEY NOT NULL,
  title                 TEXT NOT NULL,
  author                TEXT,
  local_uri             TEXT,                 -- file path in app sandbox; NULL if not on this device
  content_hash          TEXT NOT NULL,        -- SHA-256 of file bytes (hex)
  size_bytes            INTEGER,
  encoding              TEXT,
  normalization_version INTEGER NOT NULL DEFAULT 1,
  char_count            INTEGER,
  storage_path          TEXT,                 -- reserved for future file sync
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,
  dirty                 INTEGER NOT NULL DEFAULT 1,
  server_updated_at     TEXT,
  sync_error            TEXT
);
CREATE UNIQUE INDEX idx_documents_hash
  ON documents (content_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_dirty
  ON documents (dirty) WHERE dirty = 1;

CREATE TABLE reading_progress (
  document_id       TEXT PRIMARY KEY NOT NULL REFERENCES documents (id),
  char_offset       INTEGER NOT NULL CHECK (char_offset >= 0),
  percent           REAL NOT NULL CHECK (percent >= 0 AND percent <= 1),
  snippet           TEXT,
  last_read_at      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  dirty             INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error        TEXT
);
CREATE INDEX idx_progress_dirty
  ON reading_progress (dirty) WHERE dirty = 1;

CREATE TABLE bookmarks (
  id                TEXT PRIMARY KEY NOT NULL,
  document_id       TEXT NOT NULL REFERENCES documents (id),
  char_offset       INTEGER NOT NULL CHECK (char_offset >= 0),
  label             TEXT,
  snippet           TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  dirty             INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error        TEXT
);
CREATE INDEX idx_bookmarks_document
  ON bookmarks (document_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookmarks_dirty
  ON bookmarks (dirty) WHERE dirty = 1;

CREATE TABLE highlights (
  id                TEXT PRIMARY KEY NOT NULL,
  document_id       TEXT NOT NULL REFERENCES documents (id),
  start_offset      INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset        INTEGER NOT NULL,
  color             TEXT,
  note              TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  dirty             INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error        TEXT,
  CHECK (end_offset > start_offset)
);
CREATE INDEX idx_highlights_document
  ON highlights (document_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_highlights_dirty
  ON highlights (dirty) WHERE dirty = 1;

CREATE TABLE settings (
  key               TEXT PRIMARY KEY NOT NULL,   -- e.g. 'reader.fontSize'
  value             TEXT NOT NULL,               -- JSON-encoded
  updated_at        TEXT NOT NULL,
  dirty             INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error        TEXT
);

-- Sync bookkeeping: 'device_id', 'user_id', 'cursor:documents', 'last_synced_at', ...
CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
`;
