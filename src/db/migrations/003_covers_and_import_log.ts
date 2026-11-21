// Local SQLite schema, version 3.
// Adds cover dimensions (local-only, never pushed) and the import log used by
// the scan/picker diagnostics in plan 5.1.1.

export const sql = `
ALTER TABLE documents ADD COLUMN cover_width INTEGER;    -- LOCAL ONLY
ALTER TABLE documents ADD COLUMN cover_height INTEGER;   -- LOCAL ONLY

-- One row per file per import run; pruned to the latest ~200 rows.
CREATE TABLE import_log (
  id         TEXT PRIMARY KEY NOT NULL,
  file_name  TEXT NOT NULL,
  source_uri TEXT,
  status     TEXT NOT NULL CHECK (status IN ('imported','duplicate','skipped','failed')),
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_import_log_created ON import_log (created_at);
`;
