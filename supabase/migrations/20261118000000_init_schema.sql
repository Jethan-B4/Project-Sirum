-- =============================================================================
-- Offline Reader: initial Supabase schema
-- Tables: documents, reading_progress, bookmarks, highlights, settings
--
-- Design notes
--   * Every row belongs to one user (user_id) and is protected by RLS.
--   * Client-generated UUIDs are the primary keys, so offline creates and
--     retried pushes are idempotent (upsert on id).
--   * No hard deletes from clients: there is no DELETE policy or grant.
--     Clients soft-delete by setting deleted_at (tombstones sync to other devices).
--   * server_updated_at is assigned by the server (trigger). It is the pull
--     cursor, so device clock skew cannot break incremental pulls.
--   * updated_at is the client's edit time and is used for last-write-wins.
--     A trigger ignores stale writes and clamps timestamps from the future.
--   * Child rows use a composite foreign key (document_id, user_id) so a user
--     can never attach rows to another user's document.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Shared trigger function: last-write-wins + server cursor
-- -----------------------------------------------------------------------------
create or replace function public.handle_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Clamp client timestamps that are unreasonably far in the future
  -- (protects last-write-wins from a device with a wrong clock).
  if new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;

  -- Last-write-wins: silently skip updates older than what is stored.
  -- Returning NULL from a BEFORE trigger cancels the row operation without an
  -- error, so a stale upsert from an out-of-date device is a harmless no-op.
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;

  -- Server-controlled cursor for incremental pulls.
  -- clock_timestamp() (not now()) so rows written in one transaction still get
  -- distinct values most of the time. Clients should still use a compound
  -- (server_updated_at, id) cursor to be safe.
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- documents: metadata only (file contents stay on the device in v1)
create table public.documents (
  id                    uuid primary key,
  user_id               uuid not null default auth.uid()
                          references auth.users (id) on delete cascade,
  title                 text not null
                          check (char_length(title) between 1 and 500),
  author                text
                          check (char_length(author) <= 500),
  content_hash          text not null
                          check (char_length(content_hash) between 16 and 128),
  size_bytes            bigint check (size_bytes >= 0),
  encoding              text,
  normalization_version integer not null default 1,
  char_count            integer check (char_count >= 0),
  storage_path          text,            -- reserved for future file sync
  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  deleted_at            timestamptz,
  server_updated_at     timestamptz not null default clock_timestamp(),
  unique (id, user_id)                   -- target for composite foreign keys
);

-- The same book (by content hash) should exist only once per user.
-- NOTE for the sync client: if a push fails with unique violation (23505) on
-- this index, another device already registered the same file. Look up the
-- existing row by content_hash and adopt its id locally instead of retrying.
create unique index documents_user_hash_uidx
  on public.documents (user_id, content_hash)
  where deleted_at is null;

-- reading_progress: one row per document
create table public.reading_progress (
  document_id       uuid primary key,
  user_id           uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  char_offset       integer not null check (char_offset >= 0),
  percent           real not null check (percent >= 0 and percent <= 1),
  snippet           text check (char_length(snippet) <= 500),
  last_read_at      timestamptz not null,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  foreign key (document_id, user_id)
    references public.documents (id, user_id) on delete cascade
);

-- bookmarks
create table public.bookmarks (
  id                uuid primary key,
  user_id           uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  document_id       uuid not null,
  char_offset       integer not null check (char_offset >= 0),
  label             text check (char_length(label) <= 200),
  snippet           text check (char_length(snippet) <= 500),
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  foreign key (document_id, user_id)
    references public.documents (id, user_id) on delete cascade
);

-- highlights (with optional note)
create table public.highlights (
  id                uuid primary key,
  user_id           uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  document_id       uuid not null,
  start_offset      integer not null check (start_offset >= 0),
  end_offset        integer not null,
  color             text check (char_length(color) <= 32),
  note              text check (char_length(note) <= 10000),
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  check (end_offset > start_offset),
  foreign key (document_id, user_id)
    references public.documents (id, user_id) on delete cascade
);

-- settings: key/value per user.
-- value is jsonb here; the local SQLite table stores it as JSON text, so the
-- sync client should JSON.parse on pull and send the parsed value on push.
create table public.settings (
  user_id           uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  key               text not null check (char_length(key) between 1 and 100),
  value             jsonb not null check (pg_column_size(value) <= 8192),
  updated_at        timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, key)
);


-- -----------------------------------------------------------------------------
-- 3. Indexes
--    Pull cursor: WHERE user_id = ? AND (server_updated_at, id) > (?, ?)
--    Child FK lookups: speed up cascades when a document row is removed.
-- -----------------------------------------------------------------------------
create index documents_cursor_idx
  on public.documents (user_id, server_updated_at, id);
create index reading_progress_cursor_idx
  on public.reading_progress (user_id, server_updated_at, document_id);
create index bookmarks_cursor_idx
  on public.bookmarks (user_id, server_updated_at, id);
create index highlights_cursor_idx
  on public.highlights (user_id, server_updated_at, id);
create index settings_cursor_idx
  on public.settings (user_id, server_updated_at, key);

create index bookmarks_document_idx  on public.bookmarks  (document_id);
create index highlights_document_idx on public.highlights (document_id);


-- -----------------------------------------------------------------------------
-- 4. Triggers (attach the shared function to every table)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'documents', 'reading_progress', 'bookmarks', 'highlights', 'settings'
  ]
  loop
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.handle_sync_row()',
      t || '_sync_row', t
    );
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Row Level Security
--    Enabled on every table. Policies allow an authenticated user to see and
--    write only their own rows. There is deliberately NO delete policy.
--    (select auth.uid()) lets Postgres evaluate it once per statement.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'documents', 'reading_progress', 'bookmarks', 'highlights', 'settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I on public.%I for select to authenticated
         using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );

    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t
    );

    execute format(
      'create policy %I on public.%I for update to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)',
      t || '_update_own', t
    );
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Privileges
--    Defense in depth on top of RLS: the anon role gets nothing, signed-in
--    users can select/insert/update but never delete.
-- -----------------------------------------------------------------------------
revoke all on public.documents        from anon, authenticated;
revoke all on public.reading_progress from anon, authenticated;
revoke all on public.bookmarks        from anon, authenticated;
revoke all on public.highlights       from anon, authenticated;
revoke all on public.settings         from anon, authenticated;

grant select, insert, update on public.documents        to authenticated;
grant select, insert, update on public.reading_progress to authenticated;
grant select, insert, update on public.bookmarks        to authenticated;
grant select, insert, update on public.highlights       to authenticated;
grant select, insert, update on public.settings         to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Optional checks to run manually in the SQL editor after applying
-- -----------------------------------------------------------------------------
-- RLS enabled everywhere (every row should show rowsecurity = true):
--   select tablename, rowsecurity from pg_tables where schemaname = 'public';
--
-- Policies present:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' order by tablename, cmd;
--
-- Cross-user isolation: sign in as user B from the app and confirm a select
-- on documents returns none of user A's rows, and that updating one fails.
