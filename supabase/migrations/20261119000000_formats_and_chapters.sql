-- =============================================================================
-- Sirum: migration 002 (formats and chapters)
--
-- Adds what the EPUB-first reader needs on top of the initial schema
-- (20261118000000_init_schema.sql), which is already applied:
--   * documents.format          : 'epub' | 'txt' | 'pdf'
--   * documents.chapter_count   : number of chapters in the extracted book text
--   * chapter columns on reading_progress, bookmarks, and highlights, so a
--     saved position can be re-anchored inside its chapter if text extraction
--     rules ever change
--
-- Notes
--   * Existing rows get safe defaults ('txt', 1 chapter, chapter 0), so this
--     migration is backward compatible with older app versions.
--   * The local-only SQLite pieces (document_chapters, last_opened_at,
--     text_dir, cover_uri) are intentionally NOT created here.
--   * The library/reader settings (reader.percentageMode, library.orderMode,
--     library.sort, library.sortDirection, library.filters) are plain rows in
--     the existing settings table. No schema change is needed for them.
--   * Existing RLS policies, triggers, and grants on these tables stay as-is.
--     New columns are covered automatically because policies are row-level
--     and the grants are table-level.
-- =============================================================================

alter table public.documents
  add column if not exists format text not null default 'txt',
  add column if not exists chapter_count integer not null default 1;

alter table public.documents
  add constraint documents_format_check
    check (format in ('epub', 'txt', 'pdf')),
  add constraint documents_chapter_count_check
    check (chapter_count >= 1);


alter table public.reading_progress
  add column if not exists chapter_index integer not null default 0,
  add column if not exists chapter_char_offset integer not null default 0;

alter table public.reading_progress
  add constraint reading_progress_chapter_index_check
    check (chapter_index >= 0),
  add constraint reading_progress_chapter_char_offset_check
    check (chapter_char_offset >= 0);


alter table public.bookmarks
  add column if not exists chapter_index integer not null default 0,
  add column if not exists chapter_char_offset integer not null default 0;

alter table public.bookmarks
  add constraint bookmarks_chapter_index_check
    check (chapter_index >= 0),
  add constraint bookmarks_chapter_char_offset_check
    check (chapter_char_offset >= 0);


alter table public.highlights
  add column if not exists chapter_index integer not null default 0;

alter table public.highlights
  add constraint highlights_chapter_index_check
    check (chapter_index >= 0);


-- -----------------------------------------------------------------------------
-- Optional checks to run manually in the SQL editor after applying
-- -----------------------------------------------------------------------------
-- New columns exist:
--   select table_name, column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and column_name in ('format', 'chapter_count', 'chapter_index', 'chapter_char_offset')
--   order by table_name, column_name;
--
-- RLS is still enabled on every table (all rows should show rowsecurity = true):
--   select tablename, rowsecurity from pg_tables where schemaname = 'public';
