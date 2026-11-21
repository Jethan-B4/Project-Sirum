-- =============================================================================
-- Sirum: migration 003 (covers and import diagnostics)
--
-- Supabase counterpart of the local SQLite migration
-- src/db/migrations/003_covers_and_import_log.ts.
--
--   * documents.cover_width / cover_height : intrinsic pixel dimensions of the
--     normalized cover image, used to decide cover vs. contain fit (5.2.1)
--   * import_log                          : one row per file per import run,
--     pruned to the latest ~200 rows locally (5.1.1 diagnostics)
--
-- IMPORTANT — local-only for now (plan 4.8):
--   The app marks cover_width, cover_height, and the whole import_log table as
--   LOCAL ONLY. Sync pushes use explicit column lists, so these fields never
--   leave the device today. They are created here so the server schema stays
--   a superset of the local schema and a future sync feature can adopt them
--   without another migration. Until then they simply remain unused/NULL.
--
-- Notes
--   * Existing rows get NULL dimensions — safe default; the app treats NULL
--     as "unknown aspect ratio" and falls back to crop-fill.
--   * import_log gets the same RLS posture as every other table: owners can
--     select/insert/update their own rows; there is no delete policy.
--   * Existing RLS policies, triggers, and grants on documents stay as-is;
--     new columns are covered automatically (row-level policies, table-level
--     grants).
-- =============================================================================

alter table public.documents
  add column if not exists cover_width integer,
  add column if not exists cover_height integer;

alter table public.documents
  add constraint documents_cover_width_check
    check (cover_width is null or cover_width > 0),
  add constraint documents_cover_height_check
    check (cover_height is null or cover_height > 0);


-- -----------------------------------------------------------------------------
-- import_log: per-file import diagnostics. Mirrors the local table; rows are
-- currently written only on-device.
-- -----------------------------------------------------------------------------
create table if not exists public.import_log (
  id          uuid primary key,
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  file_name   text not null,
  source_uri  text,
  status      text not null check (status in ('imported','duplicate','skipped','failed')),
  reason      text,
  created_at  timestamptz not null
);

create index if not exists idx_import_log_user_created
  on public.import_log (user_id, created_at desc);

alter table public.import_log enable row level security;

create policy import_log_select_own on public.import_log
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy import_log_insert_own on public.import_log
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy import_log_update_own on public.import_log
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.import_log from anon, authenticated;
grant select, insert, update on public.import_log to authenticated;


-- -----------------------------------------------------------------------------
-- Optional checks to run manually in the SQL editor after applying
-- -----------------------------------------------------------------------------
-- New columns exist:
--   select table_name, column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and column_name in ('cover_width', 'cover_height')
--   order by table_name, column_name;
--
-- import_log exists with RLS enabled:
--   select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'import_log';
--   select policyname, cmd from pg_policies where tablename = 'import_log';
