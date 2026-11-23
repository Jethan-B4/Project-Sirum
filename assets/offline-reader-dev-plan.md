# Sirum: Offline-First Reader App (EPUB-First) Development Plan

**Stack:** React Native (Expo + TypeScript), Supabase (Postgres, Auth), Google OAuth, local SQLite, pure-JS EPUB parsing

**App name:** Sirum

**Goal:** Sirum is a reader for **EPUB (primary)**, plain text, and PDF files that works fully offline, and optionally syncs reading progress, bookmarks, highlights, notes, and settings across devices when the user is signed in and online. Only **metadata** syncs; the book files stay on each device.

---

## Decisions Locked In

| # | Topic | Decision |
|---|---|---|
| 1 | **File formats** | `.epub` (primary, first-class), `.txt`, and `.pdf` (best-effort text extraction) |
| 2 | **What syncs** | **Option A, metadata only**: progress, bookmarks, highlights, notes, settings, and document metadata. Files are never uploaded. |
| 3 | **Sync approach** | **DIY sync** (SQLite plus own push/pull against Supabase) |
| 4 | **Progress conflicts** | **Latest wins**: the position the user most recently left or read, by `updated_at` |
| 5 | **Position model** | **Character offset into the normalized text** (UTF-16 code units), with chapter-relative fields for robustness |
| 6 | **Progress display** | A synced setting, `reader.percentageMode`, asks the user whether to show **book-wide** or **chapter-only** percentage |
| 7 | **Runtime** | **Expo Go** for Phases 1 to 4, then an **EAS (cloud) development build** from Phase 5 for native Google Sign-In |
| 8 | **Library order** | A synced setting, `library.orderMode`, asks the user whether opening a book moves it to the top of the library (**recent**) or the list keeps a **fixed** order from the chosen sort and filters |
| 9 | **Layouts and views** | Two navigation layouts, a **bottom bar** or a **hidden side drawer**, and a default library layout of **2 or 3 columns**. The library filter sheet also offers list view or grid view from 2×2 to 4×4. Reference: `sirum-ui-prototype.html` |
| 10 | **Import methods** | **Manual import** (file picker) and **device scan** (Android only, through a folder the user grants access to). A setting chooses the default method. |
| 11 | **Settings and display** | A categorized settings hub (Appearance, Library, Reader, Import and storage, Sync, About). App color theme, accent color, and app font are device-local. The reading style (font family, weight, size, line height, margins, background and text color) has a synced default plus optional **per-book overrides**. The library can hide format/progress badges and title/author. |
| 12 | **Reader screen** | Layout, contents/annotations/bookmarks panel, display popup (flow, brightness, theme, text size, align, margin), and in-book search follow `sirum-reader-prototype.html` (5.6.1) |
| 13 | **Covers** | Covers are normalized at import and always shown in full, never cropped or stretched (5.2.1) |
| 14 | **Packaged app size** | Each production Android App Bundle, distributed APK and iOS IPA must be at most **100 MB (100,000,000 bytes)**. Measure the finished package, including native libraries and bundled assets. Books imported after installation are user data. |

---

## Current Status (2026-11-23)

Implementation tracking lives in `development-progress.md`. Compared with this plan, the project is further along in Phase 3 and has some differences:

- **Built and working:** TXT and EPUB import and reading, library (grid/list, filters, order modes), history, import (manual picker and Android folder scan), the categorized settings hub, app themes and fonts, per-book reading style, ask-once prompts, progress save and restore, and the reader screen with the Aa sheet.
- **Differences from the plan:** styling uses NativeWind v4 with CSS-variable theme tokens; routes live in `src/app/`, shared UI in `src/components/`, theming in `src/theme/`, and settings in `src/features/settings/` (see 3.2). Import stages files through a multi-strategy helper (5.1).
- **Reader and import updates:** Contents, bookmarks, in-book search, cover normalization and import reports are implemented. Books open at the selected chapter and render a moving window of text chunks. Interrupted imports can be retried, and repeat imports can repair a legacy cover.
- **Adaptive interface.** Library categories show labels and counts, including zero, in both themes. The grid responds to viewport width and text scale. Portrait and landscape layouts use safe-area insets. History supports a local title, author and chapter search alongside its own filters and ordering.
- **Links in the reader.** EPUB labels retain their link ranges and target anchors in normalized chapter text. TXT web addresses are also actionable. Tapping a blue link shows its destination and requires confirmation before opening an external address or moving within the book. Linked EPUB footnotes outside the chapter sequence open separately.
- **Release checks.** Run `npm run check:package-size -- <package-path>` on each production binary. The production EAS success hook runs the same check. Exercise a 500+ page book in a release build on a lower-end phone, including continuous scrolling, chapter jumps, search and rotation. Record frame timing and memory alongside release package size.
- **Remaining work:** Device performance measurements, paged flow, highlight and note creation, PDF extraction, reactive repository reads, Google sign-in and sync. The Supabase SQL still needs live verification.

---

## Table of Contents

1. [Guiding Principles](#1-guiding-principles)
2. [Phase 0: Scope and Key Decisions](#2-phase-0-scope-and-key-decisions)
3. [Phase 1: Project Setup](#3-phase-1-project-setup)
4. [Phase 2: Local-First Data Layer](#4-phase-2-local-first-data-layer)
5. [Phase 3: Core Reading Features](#5-phase-3-core-reading-features-fully-offline)
6. [Phase 4: Supabase Backend](#6-phase-4-supabase-backend)
7. [Phase 5: Authentication (Google OAuth)](#7-phase-5-authentication-google-oauth)
8. [Phase 6: Sync Engine](#8-phase-6-sync-engine)
9. [Phase 7: Testing and Hardening](#9-phase-7-testing-and-hardening)
10. [Phase 8: Polish and Release](#10-phase-8-polish-and-release)
11. [Risks and Pitfalls](#11-risks-and-pitfalls)
12. [Suggested Milestones](#12-suggested-milestones)
13. [Concise Project Initialization Steps](#13-concise-project-initialization-steps)

---

## 1. Guiding Principles

1. **The local database is the source of truth for the UI.** The UI reads and writes only to SQLite. The network is a background concern. The reader never waits on a server.
2. **Sync is a background process, not a feature of each screen.** Screens never call Supabase directly for data. A sync engine moves data between SQLite and Postgres.
3. **Auth is optional and non-blocking.** A user can import and read files with no account. Signing in unlocks sync.
4. **Every write must be safe to replay.** Use client-generated UUIDs and upserts, so a retried request never creates duplicates.
5. **Never hard-delete synced rows.** Use soft deletes (tombstones) so deletions propagate to other devices.
6. **Build in layers and verify each one.** Offline reader first, then backend, then auth, then sync. Do not mix them early.
7. **Decide conflict rules up front.** Conflicts are guaranteed with multiple devices. Decide how each data type resolves them before writing sync code.
8. **One text model for every format.** Each importer (EPUB, TXT, PDF) converts its file into the same shape: a list of chapters of normalized text. The reader, positions, bookmarks, highlights, and sync all work on that shape and never on format-specific structures.
9. **Extraction must be deterministic.** The same file must produce byte-identical normalized text and the same chapter offsets on every device, because saved offsets are only meaningful if every device agrees on them.

---

## 2. Phase 0: Scope and Key Decisions

### 2.1 Define the MVP

**In scope for v1:**
- Import **`.epub`** (primary), **`.txt`**, and **`.pdf`** files from device storage, by manual import or by scanning a folder the user allows
- Library screen (list with cover, search, sort, filter, delete) with a user-chosen ordering mode: recently opened first, or fixed order
- Two navigation layouts (bottom bar or hidden side drawer) and library view options (list, or a 2 to 4 column grid), chosen in Settings
- A categorized settings hub, app color themes and fonts, and a reading style (font, weight, size, line height, margins, colors) that can be set per book
- Reader screen (continuous scroll first; paginated later), with a contents panel, bookmarks, and in-book search
- EPUB features: table of contents, chapter navigation, cover thumbnails, title/author metadata
- Reader settings (font family, font size, line height, theme, margins, **progress display mode**)
- Reading progress saved automatically and synced
- Bookmarks
- Optional: highlights and notes
- Google sign-in
- Sync of progress, bookmarks, highlights, notes, settings, and document metadata across devices

**Explicitly out of scope for v1 (decide later):**
- DRM-protected EPUBs (detected and rejected with a clear message)
- Fixed-layout (pre-paginated) EPUBs, comics, and image-heavy books
- Inline images, tables, math, and original publisher CSS in the reader (text-first rendering)
- Layout-faithful PDF viewing, and OCR for scanned PDFs
- MOBI / AZW / DOCX
- Syncing the files themselves (Option B)
- Social features, sharing, or public libraries
- Text-to-speech, dictionary lookup, translation
- Web client

### 2.2 Supported formats and priority

| Format | Priority | Approach | Known limits |
|---|---|---|---|
| **EPUB** | **Primary.** Gets the most design and testing effort. | Unzip, parse OPF/TOC, extract each spine item to normalized text, one chapter per readable spine item (see 5.2) | Publisher styling, images, and complex layout are not preserved in v1; DRM and fixed-layout books unsupported |
| **TXT** | Secondary, and the simplest. Used as the first "walking skeleton" to validate the pipeline. | Decode (with encoding detection), normalize, treat the file as a single chapter | Messy encodings; no chapters, so chapter percentage falls back to book percentage |
| **PDF** | Best-effort. | Extract text with pdf.js inside a hidden WebView, normalize, group into chapters by outline or page blocks (see 5.4) | Scanned PDFs have no text; multi-column layouts, tables, and headers/footers extract poorly |

### 2.3 What syncs (decided: Option A, metadata only)

| Option | Description | Decision |
|---|---|---|
| **A. Metadata only** | Sync progress, bookmarks, highlights, notes, settings, and document metadata (title, author, format, content hash, counts). Files stay on each device. | **Chosen** |
| **B. Metadata and files** | Also upload files to Supabase Storage | Not in v1. The schema keeps a nullable `storage_path` so it can be added later. |

**Synced:**

| Data | Notes |
|---|---|
| Document metadata | `title`, `author`, `format`, `content_hash`, `size_bytes`, `char_count`, `chapter_count`, `normalization_version` |
| Reading progress | Latest position per document (see 2.7) |
| Bookmarks, highlights, notes | Offsets plus short snippets |
| Settings | Including `reader.percentageMode`, `library.orderMode`, `library.sort`, `library.sortDirection`, and `library.filters` |

**Never synced (stay on the device):** the original file, extracted chapter text, cover thumbnails, the local chapter index (`document_chapters`), and the local `last_opened_at` timestamp. All of these except `last_opened_at` are rebuildable from the original file.

**Matching the same book across devices:** compute a SHA-256 of the file bytes on import. Documents with the same `(user_id, content_hash)` are the same book. When a device receives a document it does not have the file for, the library shows it as **"Not on this device"** with progress and an "Import this file to continue reading" action. After the user picks a file, hash it: if the hash matches, attach the file to the existing record; if it does not, treat it as a different book instead of silently linking.

**Privacy note:** metadata-only sync still sends short text snippets (used to re-anchor positions) and note text. Keep snippets short (about 120 characters or fewer) and say so in the privacy policy.

### 2.4 Sync approach (decided: DIY)

DIY sync means SQLite plus your own change tracking and push/pull logic against Supabase.

| Approach | Verdict |
|---|---|
| **DIY sync** | **Chosen.** The data model is small (five synced tables, all per-user rows, no file sync), which fits DIY well. You get full control and no extra service. You own the edge cases: retries, conflicts, tombstones, ordering. Sections 6 and 8 describe them in detail. |
| PowerSync | Considered. Managed or self-hosted sync with an official Supabase integration. |
| WatermelonDB | Considered. Reactive local DB with a sync protocol you still implement on the server. |

**Reconsider PowerSync if:** you add file sync (Option B), you need partial or shared data sets, or sync bugs keep consuming more time than features. A one-day prototype of the alternative is cheap insurance.

### 2.5 Expo Go vs. development builds vs. bare React Native

Use **Expo**, and treat the runtime as a staged decision:

| Stage | Runtime | Why |
|---|---|---|
| **Phases 1 to 4** (local DB, offline reader, backend) | **Expo Go** on a physical device | Nothing to compile locally. `expo-sqlite`, `expo-file-system`, `expo-document-picker`, `expo-crypto`, `expo-keep-awake`, AsyncStorage, `supabase-js`, `react-native-webview`, and pure-JS libraries (EPUB parsing) all run in Expo Go. |
| **Phase 5 onward** (Google sign-in) | **Development build** made with EAS Build (cloud) | `@react-native-google-signin/google-signin` is a native module that Expo Go does not include. |
| **Release** | EAS production build | Store submission. |

Bare React Native is not needed. Local native builds (`expo run:android`) are optional: on Windows they require the Android SDK, a JDK with `JAVA_HOME`, `ANDROID_HOME`, an emulator or device, and a short project path without spaces. EAS cloud builds avoid all of that.

### 2.6 Conflict resolution policy

| Data | Policy | Reasoning |
|---|---|---|
| **Reading progress** | **Latest wins**, by `updated_at`. No "furthest" rule. | The goal is "where the user last left off", which is correct even when they deliberately re-read an earlier section. |
| Settings | Last-write-wins by timestamp | Low stakes. Do not write default values (see 5.8 and 5.9), so a default never overrides a real choice from another device. |
| Bookmarks / highlights / notes | Per-row last-write-wins; deletions win over older edits | Rows are independent, so conflicts are rare |
| Document metadata | Last-write-wins | Low stakes |

**Important consequence of latest-wins:** merely opening a book must not count as reading it. If device B opened a book at its old position and wrote progress on open, it would overwrite device A's newer position. The reader writes progress only after the user actually moves (see 5.7).

### 2.7 Position model (character offset into normalized text)

This is the central design of the reader. Every format is converted to **normalized text split into chapters**, and a position is an offset into that text.

**Definitions**
- **Normalized text:** a deterministic string produced from the file by the importer (rules in 5.2 to 5.5). Never page numbers, because pagination depends on font size, screen size, and margins.
- **Chapter:** one contiguous piece of normalized text. EPUB: one per readable spine item. TXT: exactly one for the whole file. PDF: one per outline entry, or a fixed block of pages.
- **Book text:** all chapters concatenated in order. A chapter's `start_offset` is where it begins in the book text.
- **Offset unit:** **UTF-16 code units**, i.e. the index you get from a JavaScript string. Use this everywhere, on every device, never bytes or grapheme clusters. Emoji and other characters outside the basic plane count as two units; test for this (see 9.1).

**Stored position fields**

| Field | Meaning |
|---|---|
| `char_offset` | **Primary anchor.** Global offset into the book text |
| `chapter_index` | Index of the chapter containing the position |
| `chapter_char_offset` | Offset within that chapter. Invariant: `char_offset = chapters[chapter_index].start_offset + chapter_char_offset` |
| `percent` | Book-wide fraction, `char_offset / char_count` (0 to 1). Stored so the library can show progress even when the file is not on the device |
| `snippet` | A short run of text at the position, used to re-anchor |

**Derived at display time (not stored)**
- Book percentage = `char_offset / char_count`
- Chapter percentage = `chapter_char_offset / chapter.char_count`

**Re-anchoring (when offsets may have shifted).** If a device's `normalization_version` differs from the one that produced a saved position, or the snippet does not match the text at the saved offset: go to `chapter_index`, search for the snippet near `chapter_char_offset`, and if that fails fall back to the chapter start plus the saved percentage. Chapter-relative fields are what make this robust, since a change in extraction usually shifts offsets only within a chapter.

**Versioning.** Store `normalization_version` on each document and bump it whenever any extraction or normalization rule changes. A device with a newer version re-extracts the book in the background and remaps saved positions using the procedure above.

**Progress display setting.** `reader.percentageMode` is `'book'` or `'chapter'` and controls what the reader shows. Details in 5.8.

---

## 3. Phase 1: Project Setup

### 3.1 Create the project
- Initialize an Expo app with TypeScript and Expo Router.
- Confirm it runs on a physical device in **Expo Go** (`npx expo start`, then scan the QR code). Do not use the web target: `expo-sqlite` on web needs extra WebAssembly bundler configuration, and v1 is mobile only.

### 3.2 Folder structure

```
/app                 # Expo Router screens (routes only, thin)
  (tabs)/
  reader/[id].tsx
  settings.tsx
/src
  /features
    /library         # import UI, list, search, "Not on this device" state
    /reader          # rendering, chapter navigation, progress label, settings
    /bookmarks
    /sync-status
  /formats           # one importer per format, all returning the same shape
    types.ts         # ImportedBook, Chapter
    epub/            # container.ts, opf.ts, toc.ts, extract.ts, cover.ts
    txt/             # decode.ts (encoding detection)
    pdf/             # WebView bridge and extraction
  /text              # shared text model
    normalize.ts     # normalization rules + normalization_version
    chunk.ts         # split chapters into renderable chunks
    position.ts      # offset <-> chapter/chunk conversions, percentages
    anchor.ts        # snippet-based re-anchoring
  /db
    client.ts        # opens SQLite
    migrations/      # numbered SQL migrations
    repositories/    # documents, chapters, progress, bookmarks, settings
  /sync
    engine.ts        # orchestrates push/pull
    push.ts
    pull.ts
    conflict.ts
    scheduler.ts     # triggers: launch, foreground, reconnect, debounce
  /auth
    supabase.ts      # Supabase client
    google.ts        # Google sign-in wrapper (added in Phase 5)
    session.tsx      # auth context/provider
  /lib               # utils: uuid, hash, logger
  /ui                # shared components, theme tokens
/supabase
  migrations/
  config.toml
```

**As built (2026-11-19):** routes are in `src/app/` (`index`, `history`, `import`, `settings`, `settings-*`, `reader/[id]`), shared UI in `src/components/{chrome,ui}`, theme tokens in `src/theme/`, settings in `src/features/settings/`, and NativeWind config files at the project root.

**Rule:** screens import from `features/` and `db/repositories`. Only `sync/` and `auth/` import the Supabase client. Only `formats/` knows about EPUB, PDF, or TXT internals.

### 3.3 Tooling
- **TypeScript** in strict mode.
- **ESLint and Prettier** (use Expo's lint config as a base).
- **Environment variables:** use `EXPO_PUBLIC_` prefixed vars for the Supabase URL and anon key. These are public by design. **Never put the service role key in the app.**
- **State management:** keep it light. React Context for auth/session; a query library (TanStack Query) or simple hooks over repositories for DB reads; Zustand for small UI state if needed.
- **Styling:** NativeWind v4 (Tailwind classes) with CSS-variable theme tokens injected by `ThemeProvider`. The local gate is `npx tsc --noEmit` plus `npx eslint` (flat config).
- **Git:** `.gitignore` for `.env*`, `/android`, `/ios` (generated native folders), and credentials files.
- **CI:** run typecheck, lint, and unit tests on each pull request.

### 3.4 Supabase projects
- Create at least a **dev** project; ideally also a **prod** project.
- Install the Supabase CLI and link the local repo so schema lives in version-controlled migrations.

### 3.5 Running the app: Expo Go first, development build later

**Phases 1 to 4: Expo Go**
- Install Expo Go on a physical phone and connect the phone and PC to the same Wi-Fi network.
- Run `npx expo start` and scan the QR code. Use `--tunnel` if the network blocks local connections. If `expo-dev-client` happens to be installed, add `--go` to force Expo Go.
- Do **not** install `expo-dev-client` or `@react-native-google-signin/google-signin` yet. Installing `expo-dev-client` makes Expo default to development builds, and importing the Google module inside Expo Go crashes at startup because the native code is missing.
- Run `npx expo install --check` occasionally to confirm package versions match your Expo SDK. If Expo Go reports the project is incompatible, update Expo Go or the SDK so the versions match.

**Phase 5 onward: EAS development build**
- Install `expo-dev-client` and the Google Sign-In library, then run `eas build --profile development --platform android`.
- Install the resulting APK on your phone and start the dev server with `npx expo start --dev-client`.
- Rebuild only when you add or change a native module. JavaScript changes reload instantly.

**Optional: local native builds**
- Only if you want faster native rebuilds or an emulator. Requires Android Studio (SDK, Platform-Tools, Emulator), JDK 17 with `JAVA_HOME`, `ANDROID_HOME`, and a project path that is short and has no spaces (for example `C:\dev\reader`). Long Windows paths can break the C++ steps of native builds.

### 3.6 Dependencies by phase

Install packages when a phase needs them, so each stage stays small and runs in Expo Go.

| Package | Needed from | Purpose | Runs in Expo Go |
|---|---|---|---|
| `expo-sqlite` | Phase 2 | Local database | Yes |
| `expo-crypto` | Phase 2 | UUIDs, SHA-256 content hash | Yes |
| `expo-file-system`, `expo-document-picker` | Phase 3 | File import, sandbox storage, and the Android folder scan | Yes |
| `expo-keep-awake` | Phase 3 | Keep screen on while reading | Yes |
| `expo-font` | Phase 3 | Bundled reading and app fonts | Yes |
| `nativewind` | Phase 3 (installed) | Styling | Yes |
| `expo-image`, `expo-image-manipulator` | Phase 3 (recommended) | Cover decoding, normalizing, and display (5.2.1) | Yes |
| `expo-brightness` | Phase 3 (recommended) | Reader brightness (5.6.1); verify behavior in Expo Go | Yes |
| `fflate` (or `jszip`) | Phase 3, EPUB | Unzip EPUB archives (pure JS) | Yes |
| `fast-xml-parser` | Phase 3, EPUB | Parse `container.xml`, OPF, NCX | Yes |
| `htmlparser2` (or `node-html-parser`) | Phase 3, EPUB | Parse XHTML chapters into text | Yes |
| `react-native-webview` | Phase 3, PDF | Host pdf.js for PDF text extraction | Yes |
| `@supabase/supabase-js`, `react-native-url-polyfill`, `@react-native-async-storage/async-storage` | When the Supabase client is first used (Phase 4 testing, Phase 5) | Backend client and session storage | Yes |
| `@react-native-community/netinfo` | Phase 6 | Sync triggers | Yes |
| `expo-secure-store` | Phase 5, optional | Stronger session storage | Yes |
| `expo-dev-client` | Phase 5 | Development build | Not applicable |
| `@react-native-google-signin/google-signin` | Phase 5 | Google sign-in | **No** (needs a development build) |

Before relying on any pure-JS parsing library, run a small spike on a real device in Expo Go, because Hermes (React Native's JavaScript engine) lacks some browser APIs. For example, check that UTF-8 decoding works (`fflate` provides `strFromU8` as a safe option).

---

## 4. Phase 2: Local-First Data Layer

### 4.1 Pick the local database
Use **`expo-sqlite`**. It is well supported, works offline, and supports transactions and parameterized queries. Enable WAL mode for better concurrent read/write behavior.

### 4.2 Local schema

Design every synced table with the same sync columns:

| Column | Purpose |
|---|---|
| `id` (TEXT, UUID) | Client-generated primary key |
| `created_at` | Creation time (ISO 8601 UTC text) |
| `updated_at` | Last local modification time (client clock) |
| `deleted_at` (nullable) | Soft delete marker |
| `dirty` (INTEGER 0/1) | Row has local changes not yet pushed |
| `server_updated_at` (nullable) | Server timestamp from the last successful pull/push (cursor and diagnostics) |
| `sync_error` (nullable) | Set when the server permanently rejected the row (quarantine) |

Target schema:

```sql
-- documents (synced metadata + local-only columns)
CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('epub','txt','pdf')),
  title TEXT NOT NULL,
  author TEXT,
  local_uri TEXT,                 -- LOCAL ONLY: original file in app sandbox; NULL if not on this device
  text_dir TEXT,                  -- LOCAL ONLY: folder with extracted chapter text (rebuildable cache)
  cover_uri TEXT,                 -- LOCAL ONLY: cover thumbnail
  last_opened_at TEXT,            -- LOCAL ONLY: when this device last opened the book (never synced)
  content_hash TEXT NOT NULL,     -- SHA-256 of file bytes (hex)
  size_bytes INTEGER,
  encoding TEXT,                  -- TXT only: detected/selected encoding
  normalization_version INTEGER NOT NULL DEFAULT 1,
  chapter_count INTEGER NOT NULL DEFAULT 1,
  char_count INTEGER,             -- total length of the book text (UTF-16 code units)
  storage_path TEXT,              -- reserved for future file sync
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error TEXT
);
CREATE UNIQUE INDEX idx_documents_hash ON documents(content_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_last_opened ON documents(last_opened_at);

-- document_chapters: LOCAL ONLY, never synced, rebuildable from the file
CREATE TABLE document_chapters (
  document_id TEXT NOT NULL REFERENCES documents(id),
  chapter_index INTEGER NOT NULL,
  title TEXT,
  source_href TEXT,               -- EPUB spine item path, PDF outline target
  start_offset INTEGER NOT NULL,  -- global offset where this chapter begins
  char_count INTEGER NOT NULL,
  PRIMARY KEY (document_id, chapter_index)
);

-- reading_progress (one row per document; latest wins)
CREATE TABLE reading_progress (
  document_id TEXT PRIMARY KEY NOT NULL REFERENCES documents(id),
  char_offset INTEGER NOT NULL CHECK (char_offset >= 0),
  chapter_index INTEGER NOT NULL DEFAULT 0,
  chapter_char_offset INTEGER NOT NULL DEFAULT 0,
  percent REAL NOT NULL CHECK (percent >= 0 AND percent <= 1),  -- book-wide
  snippet TEXT,
  last_read_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error TEXT
);

-- bookmarks
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  char_offset INTEGER NOT NULL CHECK (char_offset >= 0),
  chapter_index INTEGER NOT NULL DEFAULT 0,
  chapter_char_offset INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  snippet TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error TEXT
);

-- highlights (with optional note); offsets are global book-text offsets
CREATE TABLE highlights (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL,
  chapter_index INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error TEXT,
  CHECK (end_offset > start_offset)
);

-- settings (key/value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,   -- e.g. 'reader.fontSize', 'reader.percentageMode', 'library.orderMode'
  value TEXT NOT NULL,             -- JSON-encoded
  updated_at TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sync_error TEXT
);

-- sync metadata
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY NOT NULL,   -- 'cursor:documents', 'user_id', 'device_id', ...
  value TEXT
);
```

### 4.3 Design rules for the schema
1. **Client-generated UUIDs** (v4 or v7). Rows can be created offline with no collision risk. UUID v7 is time-ordered and index-friendly.
2. **Soft deletes.** Set `deleted_at` and mark `dirty`. Purge tombstones only after a long retention window and after confirming they synced.
3. **ISO 8601 UTC strings** consistently, never local time.
4. **A `device_id`** stored in `sync_state` (generated once). Useful for debugging.
5. **Keep text content out of SQLite.** Store the original file and the extracted chapter text as files in the app sandbox (`documentDirectory`); keep only metadata and the chapter index in the database. Large blobs in SQLite hurt performance.
6. **Local-only columns and tables** (`local_uri`, `text_dir`, `cover_uri`, `last_opened_at`, `document_chapters`) are never pushed. The push code must select explicit column lists, not `SELECT *`. Writing a local-only column must not set `dirty` or `updated_at`. Likewise, settings rows whose key starts with `device.` are device-local: write them with `dirty = 0` so they never push.

### 4.4 Migrations
- Keep numbered migrations (`001_init`, `002_formats_and_chapters`, ...). In this project they are TypeScript strings in `src/db/migrations/`, registered in `index.ts`.
- Track a `schema_version` (SQLite `PRAGMA user_version`) and run pending migrations on app start inside a transaction.
- Never edit a shipped migration. Add a new one.

### 4.5 Repository layer
Create one repository per entity with a small, typed API:

```ts
documents.list({ search, sort, filters, orderMode })
documents.getById(id)
documents.create(input)         // sets id, timestamps, dirty = 1
documents.update(id, patch)     // sets updated_at, dirty = 1
documents.softDelete(id)        // sets deleted_at, updated_at, dirty = 1
documents.touchOpened(id)       // sets last_opened_at ONLY (local-only; no updated_at, no dirty)
chapters.replaceForDocument(documentId, chapters)   // local only, no dirty flag
chapters.list(documentId)
progress.upsert(documentId, { charOffset, chapterIndex, chapterCharOffset, percent, snippet })
settings.get(key) / settings.set(key, value)
```

Every mutating method on a synced table must set `updated_at` and `dirty = 1`. Centralizing this prevents forgetting it, which is one of the most common sync bugs. The one deliberate exception is `documents.touchOpened`, which writes only the local-only `last_opened_at` column: opening a book must not mark the document dirty or bump `updated_at`, or every open would trigger a sync push.

### 4.6 Reactive reads
Decide how the UI re-renders when data changes: a subscription/event emitter fired by repositories after writes, or `expo-sqlite`'s change listeners, or invalidation with TanStack Query. Choose one pattern and use it everywhere.

### 4.7 Schema changes from the initial migrations

If you already created the first migrations from the earlier version of this plan (TXT-only fields), add the changes below as **new** migrations instead of editing the old ones. If you have not applied anything yet, you can fold them into the initial files.

**Local SQLite, `002_formats_and_chapters`:**

```sql
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

CREATE TABLE document_chapters (
  document_id TEXT NOT NULL REFERENCES documents(id),
  chapter_index INTEGER NOT NULL,
  title TEXT,
  source_href TEXT,
  start_offset INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  PRIMARY KEY (document_id, chapter_index)
);
```

**Supabase Postgres, `<timestamp>_formats_and_chapters.sql`:**

```sql
alter table public.documents
  add column format text not null default 'txt'
    check (format in ('epub', 'txt', 'pdf')),
  add column chapter_count integer not null default 1
    check (chapter_count >= 1);

alter table public.reading_progress
  add column chapter_index integer not null default 0 check (chapter_index >= 0),
  add column chapter_char_offset integer not null default 0 check (chapter_char_offset >= 0);

alter table public.bookmarks
  add column chapter_index integer not null default 0 check (chapter_index >= 0),
  add column chapter_char_offset integer not null default 0 check (chapter_char_offset >= 0);

alter table public.highlights
  add column chapter_index integer not null default 0 check (chapter_index >= 0);
```

`document_chapters` and `last_opened_at` have no server counterpart, because they are local-only. The library order setting needs no schema change on the server: the existing `settings` table stores the new keys.

### 4.8 Schema changes for covers and import diagnostics

Local-only, so nothing is pushed and no Supabase migration is needed. Add as a new local migration (`003_covers_and_import_log`):

```sql
ALTER TABLE documents ADD COLUMN cover_width INTEGER;    -- LOCAL ONLY
ALTER TABLE documents ADD COLUMN cover_height INTEGER;   -- LOCAL ONLY

-- One row per file per import run; prune to the latest ~200 rows.
CREATE TABLE import_log (
  id TEXT PRIMARY KEY NOT NULL,
  file_name TEXT NOT NULL,
  source_uri TEXT,
  status TEXT NOT NULL CHECK (status IN ('imported','duplicate','skipped','failed')),
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_import_log_created ON import_log (created_at);
```

The extended `reader.style` fields (5.6.1) are JSON inside an existing settings row, so they need no migration.

> **Convention for future migrations:** every change gets a numbered local migration in `src/db/migrations/` first. A matching file under `supabase/migrations/` is created **only** when the change touches synced tables/columns (`documents`, `reading_progress`, `bookmarks`, `highlights`, `settings` rows that should sync). Local-only columns (`text_dir`, `cover_uri`, `cover_width`, `cover_height`, `last_opened_at`), local-only tables (`document_chapters`, `import_log`), `device.*` settings (written with `dirty = 0`), and JSON blobs inside existing settings rows normally get **no** Supabase counterpart — sync pushes use explicit column lists, so they would never be sent anyway. Exception: `20261119000001_covers_and_import_log.sql` creates the server-side `cover_width`/`cover_height` columns and `import_log` table anyway, keeping the server schema a superset of the local one for future use; they remain unused until a sync feature adopts them. When in doubt, check whether the sync push column list would include the field.

---

## 5. Phase 3: Core Reading Features (Fully Offline)

Build and validate all of this **before** adding auth or sync. Test with airplane mode on from the start.

**Build order:** build the shared pipeline first against **TXT** (the simplest format: one chapter) to validate normalization, chunking, offsets, progress save, and restore. Then build **EPUB** (the primary format) on the same pipeline. Add **PDF** last. TXT is a thin slice, not the goal.

### 5.1 File import (common pipeline)

- Use `expo-document-picker` to choose files. Accept `.epub`, `.txt`, and `.pdf`. Do not trust MIME types alone, because Android pickers often report odd ones (EPUB is `application/epub+zip`, but may arrive as `application/octet-stream`). Validate by extension **and** content: EPUB is a ZIP (starts with `PK\x03\x04`), PDF starts with `%PDF-`.
- **Copy the picked file into the app sandbox** (`documentDirectory/books/{documentId}/original.{ext}`) so access does not depend on the original URI, which may be temporary or revoked.
  - *Android SAF & Content URI Note:* To prevent `ExponentFileSystem.copyAsync` from being rejected with `java.io.IOException` on Android content providers, stage files through a multi-strategy staging helper: try `copyAsync` first, and if rejected, fallback to base64 stream reading/writing (using `readAsStringAsync` / `StorageAccessFramework.readAsStringAsync`). Additionally, SAF directory tree scanning directly uses the child URIs returned by `readDirectoryAsync` rather than string-concatenating URIs.
- On import:
  1. Read the file bytes (check the current `expo-file-system` docs, since its API has been evolving between legacy and newer interfaces).
  2. Compute the **SHA-256 content hash** with `expo-crypto`. For very large files, measure memory use; if hashing the whole file is too heavy, use a documented partial-hash scheme (size plus sampled blocks), applied identically on every device.
  3. **Check for duplicates by hash** and offer to open the existing book (or, if the hash matches a "Not on this device" record, attach the file to it).
  4. Run the **format importer**, which returns the common shape: metadata plus a list of chapters of normalized text (5.2 to 5.4).
  5. Write each chapter's text to `books/{documentId}/chapters/0000.txt`, `0001.txt`, ... and save the cover if there is one.
  6. In **one SQLite transaction**, insert the `documents` row and the `document_chapters` rows.
- Run import as a cancellable background task with a progress indicator. Yield to the UI between chapters so large books do not freeze the app. If any step fails, delete the partial `books/{documentId}/` folder and surface a clear error.
- **Two import methods** (the default is the `device.importMethod` setting, `'scan'` or `'manual'`):
  - **Manual import:** the document picker above. Works on Android and iOS and needs no permission.
  - **Device scan (Android only):** ask for storage access, scan for `.epub`, `.txt`, and `.pdf` files, and let the user choose which to add. On Android 11 and later there is generally no blanket "storage permission" that exposes other apps' files (`READ_EXTERNAL_STORAGE` no longer covers them, and "All files access" is restricted by Google Play policy). So "storage access" means the Storage Access Framework folder picker: the user grants one folder (for example Downloads or Documents) and Sirum scans that folder tree. In Expo this is `StorageAccessFramework.requestDirectoryPermissionsAsync()` from `expo-file-system` (check the current docs, since the module is moving between legacy and new APIs). Persist the granted folder URI, handle revoked access, and hide the scan option on iOS, which has no equivalent.
  - Scan results open in a bounded, scrollable list. The selection count and **Add to library** sit below the list and stay visible as it scrolls. The action is disabled when the selection is empty or an operation is in progress.
  - Scanning shows a spinner. During a batch import the status shows the current filename and its position in the batch. Selected files use the same import pipeline as manually picked files, including duplicate detection and per-file reporting.
  - Permission state is read from the OS at runtime and is never stored as a setting.
- Later: "Open with" / share-sheet intents so users can send files to the app.

### 5.1.1 Scan and import reliability (all formats)

**Symptom:** the folder scan and the picker import only some `.epub` files. Work through these causes, most likely first, and make every file's outcome visible instead of silently skipping it.

1. **Name and type matching.** Match the decoded file name with a case-insensitive extension test (`/\.epub$/i`, also `.txt` and `.pdf`), not the MIME type or the raw content URI. SAF URIs percent-encode `/` as `%2F`, so take the last decoded path segment. Providers report `application/epub+zip`, `application/octet-stream`, `application/x-zip`, or nothing, so accept all of them and validate by content (ZIP signature `PK\x03\x04`, then `META-INF/container.xml`).
2. **Directory traversal.** Recurse every child returned by `readDirectoryAsync`, including nested folders and folders with many entries. Do not cap depth or count silently, keep a visited set, and treat a folder that fails to read as a per-folder error rather than aborting the scan.
3. **Staging.** Keep the multi-strategy `stageFile` (copy, then chunked read/write). Stream large files in chunks, measure peak memory, and delete partial copies on failure.
4. **Parser strictness.** Make the EPUB importer tolerant of: a missing or misordered `mimetype`; ZIP64 and data-descriptor archives; spaces, backslashes, or percent-encoding in paths in `container.xml`, the OPF, and manifest hrefs; an OPF in a subfolder; several `rootfile` entries (pick `application/oebps-package+xml`); a spine `idref` missing from the manifest (skip that item, do not fail); spines that are all `linear="no"`; XML with a BOM or a non-UTF-8 declaration; a missing nav or NCX (fall back to heading text); and XHTML namespaces and entities. If no chapter has text, report "No readable text (image-only or fixed layout)" instead of a generic failure.
5. **DRM detection.** An `encryption.xml` that lists only font obfuscation (`http://www.idpf.org/2008/embedding`, `http://ns.adobe.com/pdf/enc#RC`) is not DRM. Block a book only when content documents are encrypted.
6. **Memory.** Unzipping the whole archive at once loads everything. Use fflate's filtered or streaming unzip, read only the entries needed (skip large images other than the cover), and extract chapter by chapter.
7. **Duplicates.** Compare the hash only against non-deleted rows and report "Already in your library" with an option to open it, so a skipped duplicate is not mistaken for a missed file.
8. **Silent catch blocks.** Every catch writes an `import_log` row (4.8) with the reason.

**Diagnostics first.** Produce an `ImportReport` for each run (scan or picker): counts for found, imported, duplicate, skipped, and failed, plus a per-file reason list shown on the Import screen (for example "12 found, 9 imported, 2 duplicates, 1 failed: Atlas.epub, no OPF"). Add "Retry failed" and "Copy report" actions. In development builds, log the number of entries returned for each folder so a missing or truncated listing is visible.

**Acceptance test:** a folder with at least 30 EPUBs covering the corpus in 9.2 (uppercase `.EPUB`, spaces, non-ASCII and `%` in names, nested folders, one 50 MB file) imports every valid file, and every rejected file shows a reason.

### 5.2 EPUB (primary format)

An EPUB is a ZIP archive of XHTML chapters plus metadata. Parse it with pure-JS libraries (`fflate`, `fast-xml-parser`, `htmlparser2`) so it runs in Expo Go.

**Parsing steps**
1. **Unzip lazily.** Read the central directory, then decompress only the entries you need, one at a time, instead of unpacking the whole archive into memory. Be lenient: many real-world EPUBs violate the `mimetype`-first rule.
2. **`META-INF/container.xml`** gives the path of the package document (OPF). Resolve every other path relative to the OPF's folder, URL-decode percent-escapes, and normalize `../` segments.
3. **OPF package document:**
   - `<metadata>`: title (`dc:title`), author (`dc:creator`), identifier, language.
   - `<manifest>`: id to href and media type, with properties such as `nav` and `cover-image`.
   - `<spine>`: the ordered reading list. In v1, use items with `linear` not set to `no`.
4. **Table of contents:** EPUB 3 uses the nav document (`<nav epub:type="toc">`); EPUB 2 uses the NCX file referenced by the spine's `toc` attribute. Map TOC entries to spine items by href (ignoring the `#fragment`) to get chapter titles and a TOC tree for the navigation drawer.
5. **Cover:** EPUB 3 `cover-image` property; EPUB 2 `<meta name="cover">`; fall back to the first image of the first spine item. Save a downscaled thumbnail (local only).
6. **Extract text** from each readable spine item (rules below). The ordered list of non-empty results is the chapter list, and `chapter_index` is the index in that list (not the raw spine index). Skip spine items whose normalized text is empty (cover pages, image-only pages).
7. **Chapter title:** the TOC label if present; otherwise the first heading in the chapter; otherwise "Section N".
8. **Detect unsupported books:** `META-INF/encryption.xml` with algorithms other than font obfuscation means DRM; `rendition:layout` of `pre-paginated` means fixed layout. Show a clear message and do not import. (Font obfuscation is not DRM and is fine.)

**Text extraction rules (deterministic; any change bumps `normalization_version`)**
- Parse XHTML leniently. Ignore `<head>`, `<script>`, `<style>`, and `<svg>`. Images contribute no text in v1.
- **Block elements** (`p`, `div`, `h1` to `h6`, `li`, `blockquote`, `pre`, `tr`, `section`, `article`, and similar) end a paragraph with `\n`. `<br>` becomes `\n`.
- Outside `<pre>`, collapse runs of whitespace (including source newlines) to a single space and trim each paragraph. Drop empty paragraphs and never emit more than one `\n` in a row. A paragraph is one line; the reader draws paragraph spacing from the setting.
- Decode HTML entities. Convert non-breaking spaces to normal spaces and remove soft hyphens (U+00AD).
- Apply the shared normalization from 5.5 (Unicode NFC and so on).
- Chapter text is paragraphs joined by `\n`, with no leading or trailing newline.
- Optional, later: record heading and emphasis ranges in a **side-car spans list** stored beside the chapter text. It styles headings and italics without changing any offsets.

**Known EPUB pitfalls**
- **One giant spine file, or hundreds of tiny ones.** Some books put the whole text in one spine item; others split chapters into many small files. Chapter percentage is only as meaningful as the chapters. v1 uses spine items; a later improvement groups spine items by TOC entries, so one TOC chapter spans several files.
- **Missing or wrong TOC** and TOC entries that point into the middle of a spine file (fragments).
- **CJK, right-to-left, and ruby text:** extraction works, but rendering and text selection need testing.
- **Internal links, footnotes, tables, and math** are flattened to text in v1.
- **Memory and time:** extract chapter by chapter, write each to disk, and release it. Show progress.

**Extraction cache layout (rebuildable from the original)**

```
documentDirectory/books/{documentId}/
  original.epub
  chapters/0000.txt
  chapters/0001.txt
  cover.jpg
```

### 5.2.1 Cover images (show the full cover at the right aspect ratio)

**Symptom:** covers load but are drawn at the wrong size or aspect ratio. **Check first:** the image is stretched into a fixed box; the frame ratio differs from the image ratio and `cover` crops it; bytes are saved as `cover.jpg` whatever their real type (PNG, GIF, WebP, or SVG, which React Native `Image` cannot draw); the "cover" found is a banner or title page; or huge originals are scaled by the card.

1. **Pick the right image.** In order: EPUB 3 `cover-image` property; EPUB 2 `<meta name="cover">` (the value is a manifest id, so resolve it through the manifest rather than treating it as a path); a manifest image whose id or href contains "cover"; the `guide` reference of type `cover`; the first image of the first spine page (if that page is an SVG wrapper, use its `<image>` href). Skip SVG and fall back to the generated cover.
2. **Normalize once at import.** Detect the type from magic bytes (never the extension), decode it, read the intrinsic width and height, downscale so the long edge is at most 1200 px, re-encode as JPEG (PNG if it has transparency) with `expo-image-manipulator`, save with the correct extension, and store `cover_width` and `cover_height` (4.8).
3. **Show the whole image.** Library frames are 2:3 and sized from the card width (`aspectRatio: 2/3`), never from the image's pixel size. If the cover's ratio is within about 8% of 2:3, fill the frame (`contentFit="cover"`). Otherwise (square art, wide banners, logos) use `contentFit="contain"`, centered over a blurred, dimmed copy of the same image, so all of the artwork is visible with no cropping or stretching. A device-local setting `device.coverFit` (`'full'` by default, or `'crop'`) lets users always crop-fill instead.
4. **Use `expo-image`** for caching and `contentFit`, with the generated gradient cover as the fallback when no usable image exists.
5. **Rows and history** use the same cover component (small 2:3 frame, same rule).

**Tests:** portrait, square, wide banner, tiny (64 px), very large, PNG, WebP, GIF, SVG, and missing covers. Each renders uncropped, unstretched, and without layout jumps.

### 5.3 TXT

A text file is treated as a **single chapter**. Chapter percentage falls back to book percentage for TXT (the setting is hidden or ignored for single-chapter documents).

**Encoding handling.** Text files in the wild are messy:
- **UTF-8** (with and without BOM), **UTF-16 LE/BE** (BOM-detected), **Windows-1252 / ISO-8859-1**, and regional encodings (Shift-JIS, GBK, Big5, EUC-KR, etc.)
- Detect BOM first; then try strict UTF-8 validation; fall back to a detection library or let the user pick the encoding manually ("Text looks garbled? Change encoding").
- Store the chosen encoding in `documents.encoding`. Changing it re-runs extraction and bumps the book's text, so confirm with the user, because offsets may shift.
- Optional later: split long TXT files into chapters by heading heuristics ("Chapter 1", "CHAPTER I", and so on).

### 5.4 PDF (best-effort)

PDFs are page-layout documents, not reflowable text, so PDF support is intentionally limited in v1.

**Approach: reflowable text extraction.** Run **pdf.js inside a hidden `react-native-webview`** (it runs in Expo Go) to extract text per page, then pass the result back to React Native over the WebView message bridge. The pdf.js assets must be bundled locally so extraction works offline. Treat this as a **spike to validate on a real device first**, since loading local assets and workers inside a WebView has platform quirks.

- Reconstruct lines from text positions, then join lines into paragraphs by vertical spacing. Remove line-ending hyphenation where safe, and drop repeated page headers, footers, and bare page numbers.
- **Chapters:** top-level outline (bookmark) entries if the PDF has them; otherwise fixed blocks (for example 10 pages each).
- The heuristics above are the "normalization rules" for PDF. They must be deterministic and versioned, and the pdf.js version must be pinned, so every device extracts the same text.
- **Limitations to tell the user:** scanned or image-only PDFs have no extractable text (show "No readable text found"); multi-column pages, tables, and math extract poorly. Offer "Open in another app" as a fallback.
- A **layout-faithful PDF viewer** (native module such as `react-native-pdf`) needs a development build, so it is a post-Phase 5 option. If added, positions for that view would be page-based and would not match the text-offset model, so treat it as a separate mode.

### 5.5 Shared normalization

Every format's output passes through the same normalization in `src/text/normalize.ts`:
- Line endings to `\n`; strip BOM; Unicode NFC.
- Remove control characters except `\n` and tab.
- Chapter text has no leading or trailing newline.
- Export a constant `NORMALIZATION_VERSION` and store it on each document. Bump it for **any** change to this file or to a format's extraction rules.

Character offsets are computed against this normalized text only, as UTF-16 code units. Never compute an offset against raw file contents.

### 5.6 Rendering large books efficiently

Rendering a whole chapter, let alone a whole book, as one `<Text>` will freeze or crash the app. Use **chunking over chapters**:

| Strategy | Description | Notes |
|---|---|---|
| **Chunked virtual list** | Split each chapter into chunks (about 2 to 5 KB) at paragraph (`\n`) boundaries, and render all chunks of the book with `FlatList` / `FlashList` | **v1 choice.** The chunk is the unit of position |
| Paragraph virtualization | One list item per paragraph | Simplest, but very long paragraphs are still a problem |
| Pagination | Measure text and split into pages per screen size and font settings | Better "book" feel; expensive and recomputed when font or margins change; add after v1, lazily around the current position |

**Supporting pieces**
- Build a **chunk index** per chapter (array of chunk start offsets) when first opened, cached beside the chapter file or in memory. Combined with `document_chapters.start_offset`, any global offset maps to a (chapter, chunk, position) triple quickly.
- Load chapter files lazily; keep only the visible chunks plus a buffer in memory.
- Hard-wrap chunks that exceed a maximum length (for example, a single-line file).
- **Chapter navigation:** a table-of-contents drawer built from the TOC tree, previous/next chapter controls, and a heading for each chapter in the scroll.
- Render chapter headings and chunks with the reader theme settings; apply highlights by splitting chunk text into styled spans.

### 5.6.1 Reader screen layout and features

Reference prototype: `sirum-reader-prototype.html`. The scrolled reader now renders a bounded window of chunks around the current passage.

- **Top bar:** back, book title, in-book search, display (Aa), and an overflow menu with **Add bookmark**, **Contents**, and **Settings**.
- **Bottom bar:** current chapter title, a percentage, and a scrubber. The percentage and scrubber follow `reader.percentageMode` (5.8).
- **Contents panel** (opens from the right, three tabs): **Contents** (chapter list from `document_chapters`, current chapter highlighted, tap to jump), **Annotations** (highlights and notes), and **Bookmarks** (chapter and percent, tap to jump).
- **Display popup** (from Aa):
  - **Flow:** Auto, Paged, or Scrolled. Scrolled is v1. Paged paginates lazily around the current position, with tap zones on the left and right thirds. Auto picks paged on wide screens and scrolled on phones.
  - **Brightness:** `expo-brightness` or a dimming overlay, stored as `device.readerBrightness`; restore the system value on exit.
  - **Theme:** swatches (white, dark gray, black, sepia) plus custom background and text colors.
  - **Text size** (percent), **text align** (left or justify), and **margin** (percent of width), each with minus and plus controls.
  - These write `reader.style`, or the per-book override when "This book only" is chosen. Add that switch to the popup (the prototype omits it). `reader.style` gains `flow` and `align`, and `size` and `mar` become percentages instead of pixels.
- **In-book search:** the search icon opens a full-screen search. An empty query lists recent searches (device-local `device.searchHistory`, last 10, with a clear action). Typing shows live results (chapter title and a snippet with the match highlighted), and tapping a result jumps to that chapter and offset. Scan the normalized chapter files one at a time, yielding between chapters, with a result cap (for example 200). Add an FTS index only if scanning is too slow. Voice input is out of scope for v1.
- **Bookmarks:** add from the menu; store `char_offset`, `chapter_index`, `chapter_char_offset`, and a short snippet (5.11).

### 5.7 Saving progress locally

- On scroll, find the first visible chunk and the offset within it, then compute: `chapter_index`, `chapter_char_offset`, global `char_offset`, book `percent`, and a short `snippet` (about 80 to 120 characters at the position).
- **Write progress only after the user actually moves.** Opening a book restores the saved position and writes nothing. Require meaningful movement (for example, more than a screenful or a few hundred characters, or a short dwell time) before the first write. This keeps latest-wins correct: a device that merely opened the book never overwrites a newer position from another device.
- **Debounce** writes (at most every 2 to 5 seconds while scrolling) and also flush on: app going to background, leaving the reader screen, and unmount.
- Always write through the repository so `dirty = 1` and `updated_at` are set.
- On opening a document, restore from `reading_progress`. Validate with the snippet; if it does not match (extraction version changed), re-anchor as described in 2.7.
- If a pull brings a **newer** position for the open book from another device, do not jump silently mid-sentence. Apply it automatically when the book is next opened. While the reader is open, show a small non-blocking "Jump to latest position?" prompt.

### 5.8 Progress display and the percentage setting

The setting `reader.percentageMode` controls what the reader shows next to the scrubber and in the progress label.

| Mode | Shown | Computed as |
|---|---|---|
| `book` | "37% of book" | `char_offset / char_count` |
| `chapter` | "Ch. 5 of 23 · 42%" (percentage within the current chapter) | `chapter_char_offset / chapter.char_count` |

Behavior:
- **Ask once.** The first time the user opens an EPUB (or a PDF with chapters), show a short prompt: "How should reading progress be shown? Whole book / Current chapter." Explain that it can be changed later in **Settings > Reading > Progress display**.
- **No default write.** Until the user answers, treat the mode as `book` in memory, but do **not** store it. Storing a default would let a default overwrite a real choice made on another device. Once any device has stored a value, it syncs and other devices skip the prompt.
- The scrubber follows the mode: in `chapter` mode it scrubs within the current chapter; in `book` mode, across the whole book.
- Single-chapter documents (TXT, and PDFs without chapters) always show the book percentage.
- The **library list** always shows book-wide progress, because a chapter percentage is not meaningful out of context.
- Optionally let a tap on the progress label toggle the mode.
- The mode is only a display preference. Stored positions and sync are identical in both modes.

### 5.9 Library screen

- List documents with **cover**, title, author, format badge, book progress percent, and last read time.
- Search by title and author (SQLite `LIKE` or FTS5 if needed).
- Show documents known from sync but without a local file as **"Not on this device"**, with an "Import this file" action (see 2.3).
- Swipe or long-press to delete (soft delete in the DB; remove the local files, or defer removal until the tombstone has synced).
- Empty state with an obvious "Import a book" action.

**Ordering is a user choice (`library.orderMode`)**

Some readers want the book they just opened on top; others want a stable, predictable list. Make it a setting:

| Mode | Behavior |
|---|---|
| `recent` (**Recently opened first**) | Opening a book moves it to the top of the list. The list is always ordered by recency (below). The sort menu is replaced by a "Recently opened" label; filters still apply. |
| `fixed` (**Fixed order**) | The order comes only from the chosen sort and filters. Opening or reading a book never moves it (with stable sort keys; see below). |

- **Recency** is the latest of three timestamps: the device-local `last_opened_at`, the synced `reading_progress.last_read_at`, and `created_at`. Using both means a book you read on another device also rises in the list, and a book you merely opened on this device does too.
- **Sort options (fixed mode):** title, author, date added, last read, and progress, each ascending or descending. Title, author, and date added are stable keys. Last read and progress change as the user reads, which is acceptable because the user chose them explicitly.
- **Filter options:** format (EPUB, TXT, PDF) and status (unread, in progress, finished). Status is derived from progress: unread = no progress row, finished = book percent at or above 0.99, in progress otherwise. "Not on this device" is not a stored filter, because it differs per device.
- **Do not reorder the list while it is on screen.** Apply the new order the next time the library screen gains focus, so rows never jump under the user's thumb.
- **Ask once.** The first time the user opens a book while the library holds two or more books, show a short prompt: "How should your library be ordered? Move the book I open to the top, or keep my order (use sort and filters)." Explain that it can be changed later in **Settings > Library > Order**. Same rule as 5.8: until the user answers, behave as `recent` in memory, but do **not** store a default, so a default cannot override a choice made on another device.
- **Persistence:** `library.orderMode`, `library.sort`, `library.sortDirection`, and `library.filters` are stored in the `settings` table and sync. Write only values the user actually changed.
- **Implementation notes:**
  - `documents.touchOpened(id)` writes only the local `last_opened_at` column. It must not set `dirty` or `updated_at`; otherwise every open would mark the document dirty and trigger a sync push.
  - Call it when the reader screen opens a book that has a local file.
  - Example recency query (ISO 8601 UTC strings compare correctly as text):

```sql
SELECT d.*, p.percent, p.last_read_at,
       MAX(COALESCE(d.last_opened_at, ''),
           COALESCE(p.last_read_at, ''),
           d.created_at) AS recency
FROM documents d
LEFT JOIN reading_progress p
  ON p.document_id = d.id AND p.deleted_at IS NULL
WHERE d.deleted_at IS NULL
ORDER BY recency DESC;
```

**Navigation layout and view modes**

Reference prototype: `sirum-ui-prototype.html`.

- **Navigation layout** (`device.navMode`): `bottom` shows a bottom tab bar (Library, History, Import, Settings) with format tabs (All, EPUB, TXT, PDF) under the app bar. `side` hides navigation in a drawer opened from the app bar, with the same destinations and the format filters as drawer items.
- **Default library layout** (`device.libraryLayout`): 2 columns (cover with a title and author caption below) or 3 columns (cover with the title overlaid, progress and format badges, and a continue button). These are only starting layouts.
- **View options:** the filter/sort sheet lets the user switch between list view and grid view with sizes 2×2, 3×3, and 4×4 (that many columns; rows scroll), saved as `device.viewMode` and `device.gridSize`. Cards use the caption style at 2 columns and the overlay style at 3 and 4. Choosing a default layout resets the view to grid at that size.
- **Display options:** the user can hide the format and progress badges (`device.showBadges`) and the title and author (`device.showDetails`) for a cleaner, cover-only look. List view always shows the title, since a row without one is not usable. Keep an accessibility label on each cover when the title is hidden.

**Library and History list rows**

- Both screens place the cover on the right and book details on the left. Library shows the title, author and date added.
- History shows the title, author, saved chapter and last-read date and time in the device locale. A numbered chapter label provides a fallback when the chapter has no distinct title.
- History includes books with a saved reading-progress row, including a saved position at 0%. It opens newest read first using `reading_progress.last_read_at`. Its newest/oldest sort and All, In progress and Finished filters apply only to History.

### 5.10 Settings

Settings are a hub of categories, each opening its own page (reference: `sirum-ui-prototype.html`):

| Category | Contents |
|---|---|
| **Appearance** | Color theme (system, dark, light, sepia), accent color, app font |
| **Library** | Navigation layout, default library layout, library order, show or hide badges, show or hide title and author |
| **Reader** | Progress display (whole book or chapter), default reading display (below) |
| **Import and storage** | Import method, storage access |
| **Sync** | Google account, sync status, sync now (Phase 5 and 6) |
| **About** | Version, privacy policy, licenses |

**App appearance (device-local):** theme, accent color, and app font apply to menus and the library. The reading font is separate. Fonts must be bundled with `expo-font` (system fonts plus a few bundled families); letting users add their own font files is a later option.

**Reading display:** font family, font weight, font size, line height, margins, background color, and text color, with presets (Dark, Light, Sepia). These are style only and never change character offsets, so positions, bookmarks, and highlights stay valid.
- **Default for all books:** stored as one synced setting, `reader.style` (JSON).
- **Per-book override:** inside a book, the display sheet (Aa) has an "All books / This book only" switch. A book override is stored as a synced setting `reader.book.<documentId>` holding only the changed fields, so no schema change is needed (the key stays under the 100-character limit). The style shown is `{ ...reader.style, ...override }`. "Reset this book" writes an empty object. Purge a book's override row locally when the book is deleted.
- Changing the default later does not touch fields a book has overridden.

**Reader**
- **Display:** font family, weight, size, line height, margins, background and text color (default for all books, overridable per book)
- Paragraph spacing and text alignment (left, justified)
- **Progress display:** whole book or current chapter (5.8)
- Keep screen awake while reading (`expo-keep-awake`)

**Library**
- **Library order:** recently opened first, or fixed order (5.9)
- Default sort, sort direction, and filters (sort applies in fixed mode; filters apply in both modes)

**Layout**
- Navigation layout: bottom bar or side drawer
- Default library layout: 2 or 3 columns (view mode and grid size are also set from the library filter sheet)
- Show or hide format and progress badges, and title and author

**Import**
- Import method: scan device or manual import
- Storage access: shows the current state, with a button to request or revoke it

All settings live in the `settings` table so they sync. Write only values the user actually changed.

| Key | Values | Notes |
|---|---|---|
| `reader.percentageMode` | `'book'`, `'chapter'` | Asked once (5.8) |
| `library.orderMode` | `'recent'`, `'fixed'` | Asked once (5.9) |
| `library.sort` | `'title'`, `'author'`, `'added'`, `'lastRead'`, `'progress'` | Used in fixed mode |
| `library.sortDirection` | `'asc'`, `'desc'` | Used in fixed mode |
| `library.filters` | JSON: `{ formats?: [...], status?: [...] }` | Used in both modes |
| `device.navMode` | `'bottom'`, `'side'` | Device-local |
| `device.libraryLayout` | `'cols2'`, `'cols3'` | Device-local |
| `device.viewMode` | `'grid'`, `'list'` | Device-local |
| `device.gridSize` | `2`, `3`, `4` | Device-local |
| `device.importMethod` | `'scan'`, `'manual'` | Device-local |
| `device.theme` | `'system'`, `'dark'`, `'light'`, `'sepia'` | Device-local |
| `device.accent` | `'green'`, `'purple'`, `'blue'` | Device-local |
| `device.appFont` | `'system'`, `'serif'`, `'humanist'`, `'mono'` | Device-local |
| `device.showBadges`, `device.showDetails` | `true`, `false` | Device-local |
| `device.coverFit` | `'full'`, `'crop'` | Device-local (5.2.1) |
| `device.searchHistory` | JSON array of up to 10 strings | Device-local (5.6.1) |
| `device.readerBrightness` | number 20 to 100 | Device-local (5.6.1) |
| `reader.style` | JSON: `{ fam, wt, size, lh, mar, bg, tx, flow, align }` | Default reading style. `size` and `mar` are percentages. Replaces separate font and theme keys |
| `reader.book.<documentId>` | JSON: partial of `reader.style` | Per-book override, changed fields only |

Centralize key names, value types, and in-memory defaults in `src/lib/settingsKeys.ts`.

Keys that start with `device.` are device-local: a phone and a tablet may want different layouts, and scanning does not exist on iOS. Store them in the same table with `dirty = 0` and exclude them from push, so they never sync.

### 5.11 Bookmarks, highlights, notes
- Bookmark: store `char_offset`, `chapter_index`, `chapter_char_offset`, and a snippet.
- Highlight: store global start/end offsets and `chapter_index`; render by splitting chunk text into styled spans. Shows the highlighted text by slicing the local normalized text.
- Notes attach to a highlight or bookmark.
- Because offsets are against normalized text, they stay stable across font changes. A bookmark list can group by chapter using the chapter title.

### 5.12 Accessibility and UX details
- Dynamic type / system font scaling support
- Screen reader labels for controls, including the progress label and scrubber
- Safe-area handling and gesture-friendly controls (tap zones for next/previous in paginated mode)
- Handle device rotation without losing position
- Chapter list that is easy to reach with one hand

**Exit criterion for Phase 3:** a user with no account and no network can import an EPUB, read it, jump between chapters, bookmark, change settings (including progress display), close the app, reopen it, and land exactly where they left off. The same holds for TXT, and for text-based PDFs. The library follows the chosen order mode: in `recent` mode the opened book moves to the top, and in `fixed` mode it stays where the sort and filters put it.

---

## 6. Phase 4: Supabase Backend

### 6.1 Schema mirrors the local schema (with differences)

Differences from the local database:
- Add `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` to every table.
- Remove `dirty`, `sync_error`, and all local-only columns and tables (`local_uri`, `text_dir`, `cover_uri`, `document_chapters`).
- Add `server_updated_at timestamptz NOT NULL`, maintained by a trigger. This is your **pull cursor**. Using a server-controlled timestamp avoids problems with device clock skew.
- Keep client `updated_at` for conflict resolution; keep `server_updated_at` for ordering and incremental pulls.
- Child tables use a **composite foreign key** `(document_id, user_id)` so a user can never attach rows to another user's document.
- `settings.value` is `jsonb` on the server and JSON text locally.

```sql
create table public.documents (
  id uuid primary key,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  format text not null default 'txt' check (format in ('epub', 'txt', 'pdf')),
  title text not null check (char_length(title) between 1 and 500),
  author text check (char_length(author) <= 500),
  content_hash text not null check (char_length(content_hash) between 16 and 128),
  size_bytes bigint check (size_bytes >= 0),
  encoding text,
  normalization_version integer not null default 1,
  chapter_count integer not null default 1 check (chapter_count >= 1),
  char_count integer check (char_count >= 0),
  storage_path text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  unique (id, user_id)
);

create unique index documents_user_hash_uidx
  on public.documents (user_id, content_hash) where deleted_at is null;
create index documents_cursor_idx
  on public.documents (user_id, server_updated_at, id);
```

Repeat the pattern for `reading_progress`, `bookmarks`, `highlights`, and `settings`, including the new chapter columns (section 4.7). Add range checks and length limits (for example snippet at most 500 characters, note at most 10000) to cap abuse.

**Unique-hash note for the sync client:** if two devices import the same file offline, the second push hits the unique `(user_id, content_hash)` index (error `23505`). The client should look up the existing row by `content_hash` and adopt its `id` locally, then re-point its child rows, instead of retrying forever.

### 6.2 Row Level Security (non-negotiable)

Enable RLS on **every** table in the `public` schema. Without policies, the table is inaccessible to clients, which is the safe default.

```sql
alter table public.documents enable row level security;

create policy "documents_select_own" on public.documents
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "documents_insert_own" on public.documents
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "documents_update_own" on public.documents
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: clients soft-delete via update.
```

Notes:
- Wrapping `auth.uid()` in `(select ...)` lets Postgres cache it per statement, which improves performance on large tables.
- Omit hard-delete policies and revoke `delete` from `anon` and `authenticated` to enforce the soft-delete rule at the database level.
- Test policies with a second user account to confirm isolation.

### 6.3 Server-side conflict handling (latest wins)

A plain `upsert` overwrites whatever is there, which can clobber newer data from another device. Since every table uses latest-wins, a single **shared `BEFORE INSERT OR UPDATE` trigger** can enforce it for all tables, so the client can use plain upserts:

```sql
create or replace function public.handle_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Clamp client timestamps that are far in the future (wrong device clock).
  if new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;

  -- Latest wins: silently ignore writes older than what is stored.
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;

  new.server_updated_at := clock_timestamp();   -- server-controlled pull cursor
  return new;
end;
$$;

create trigger documents_sync_row
before insert or update on public.documents
for each row execute function public.handle_sync_row();
-- attach the same trigger to the other four tables
```

Returning `NULL` from a `BEFORE` trigger cancels that row's write without an error, so a stale push from an out-of-date device is a harmless no-op, and the device later pulls the newer row. Equal timestamps are accepted, so the last writer wins a tie and every device converges on the server's copy.

An RPC function with a conditional `ON CONFLICT ... WHERE existing.updated_at < excluded.updated_at` is an equivalent alternative if you prefer explicit per-table functions.

### 6.4 Storage (not used in v1)
Option A syncs metadata only, so no Storage bucket is needed. If file sync is added later: a **private** bucket, path convention `{user_id}/{content_hash}.{ext}`, Storage RLS limiting users to their own prefix, and quotas for file size and total storage.

### 6.5 Schema management
- Use `supabase migration new <name>` and commit the SQL files in `supabase/migrations/`.
- Apply with `npx supabase db push --remote` to the linked hosted project. Recent CLI versions default to the **local Docker stack**, so `--remote` is required for a hosted project.
- Avoid making schema changes only through the dashboard; they drift out of version control. If you paste SQL into the SQL Editor once, run `npx supabase migration repair --status applied <timestamp>` so `db push` does not apply it twice.
- Generate TypeScript types with `supabase gen types typescript` and use them in the sync code.

### 6.6 Other backend considerations
- **Rate limits and abuse:** consider limiting row counts per user, and payload sizes.
- **Account deletion:** required by app stores when accounts can be created in-app. `ON DELETE CASCADE` from `auth.users` plus a delete-account flow (an Edge Function using the service role key, called server-side) covers it.
- **Backups:** know your plan's backup/PITR features before going live.

---

## 7. Phase 5: Authentication (Google OAuth)

### 7.1 Google Cloud setup
1. Create a Google Cloud project.
2. Configure the **OAuth consent screen** (app name, support email, logo, privacy policy URL, authorized domains).
3. Create OAuth client IDs:
   - **Web client ID:** used by Supabase (Client ID and Secret go into the Supabase Google provider) and passed to the native library as the `webClientId`.
   - **Android client ID:** requires your package name and the SHA-1 fingerprint(s) of your signing keys. Add the debug key, the EAS/upload key, and the Google Play app signing key as needed. With EAS builds, `eas credentials` shows the SHA-1 of the signing key EAS manages for you.
   - **iOS client ID:** requires your bundle ID.
4. Keep dev and prod credentials organized. Mismatched SHA-1 fingerprints are the most common cause of Android sign-in failure (`DEVELOPER_ERROR`).

### 7.2 Supabase setup
- Enable the **Google** provider and paste the Web client ID and secret.
- Add the authorized client IDs (Android and iOS) as needed per the Supabase Google provider docs.
- If you see nonce-related errors on iOS when using the native library, review the provider's nonce settings in the Supabase dashboard and the current Supabase docs for the recommended configuration.
- Configure redirect URLs/deep-link scheme if you also support browser-based OAuth as a fallback.

### 7.3 Choose the sign-in flow

| Flow | How | Pros | Cons |
|---|---|---|---|
| **Native Google Sign-In** (`@react-native-google-signin/google-signin`) then `supabase.auth.signInWithIdToken({ provider: 'google', token })` | Native account picker, returns an ID token | Best UX, no browser hop, reliable on Android | Needs a dev build and native config |
| **Browser-based OAuth** (`supabase.auth.signInWithOAuth` + `expo-auth-session` / `expo-web-browser`) | Opens a browser/custom tab and redirects back via deep link | Works with simpler setup, same flow for any provider | Redirect handling is more fragile, more UI friction |

**Recommendation:** native sign-in as the primary flow, with browser-based OAuth as an optional fallback.

**Expo Go cannot run the native library.** Install `expo-dev-client` and `@react-native-google-signin/google-signin` only at the start of this phase, create an EAS development build, and run the app with `npx expo start --dev-client` from then on. Until then, keep any file that imports the Google library out of the app's import tree.

```ts
// src/auth/google.ts (sketch)
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { supabase } from './supabase';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

export async function signInWithGoogle() {
  await GoogleSignin.hasPlayServices();
  const result = await GoogleSignin.signIn();
  // The shape of `result` differs between library versions: check the docs for the idToken location.
  const idToken = /* result.data?.idToken or result.idToken */ '';
  if (!idToken) throw new Error('No ID token from Google');
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  return data;
}
```

### 7.4 Supabase client and session persistence

```ts
// src/auth/supabase.ts (sketch)
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
```

Additional details:
- **Token refresh lifecycle:** with React Native, start/stop auto-refresh based on `AppState` (call `supabase.auth.startAutoRefresh()` when the app is active and `stopAutoRefresh()` when backgrounded), as recommended in Supabase's React Native guidance.
- **Secure storage:** `expo-secure-store` has a per-value size limit that a full session JSON can exceed. A common pattern is to encrypt the session with a key stored in SecureStore and keep the encrypted blob in AsyncStorage. Decide based on your threat model. AsyncStorage is acceptable for many apps, but SecureStore-backed storage is stronger.
- **Offline session behavior:** a stored session should keep the user "signed in" while offline. Do not force a sign-out just because a token refresh fails with a network error. Only treat explicit auth errors (revoked/invalid refresh token) as sign-out conditions.

### 7.5 Make auth optional (local-first identity)
Design for three states:

1. **Anonymous/local:** no account. All data has `dirty = 1` and is never pushed.
2. **Signed in:** sync enabled.
3. **Signed out after being signed in:** user decides what to do with local data.

**First sign-in (migrating local data):**
- On a successful first sign-in, mark all existing local rows as `dirty = 1` and set the active `user_id` in `sync_state`.
- Push local data to the account. If the account already has data from another device, run the normal pull and merge, using `content_hash` to match duplicate documents.

**Switching accounts on one device:** if a different user signs in than the one who owns the local data, prompt: keep separate? merge? wipe? Simplest safe policy: store `user_id` in `sync_state`; if it changes, clear synced local data (after confirming with the user) rather than silently leaking one user's data into another account.

**Sign-out options:**
- Keep local data, but stop syncing (book-friendly)
- Clear all local data (privacy-friendly, shared devices)

Offer the choice, and push pending changes first when online.

### 7.6 Auth UI
- A non-intrusive "Sign in to sync" entry in Settings, plus a gentle prompt after the user has read for a while.
- Show account email/avatar, sync status, last sync time, and a sign-out button.
- Include a delete-account option (required by store policies).

---

## 8. Phase 6: Sync Engine (DIY)

### 8.1 Core model

Two directions, run in order: **push, then pull** (or pull then push, as long as you are consistent and handle conflicts).

- **Push:** find rows with `dirty = 1`, send them to Supabase using **explicit column lists** (never local-only columns), then mark them clean **only if the row was not modified again during the request** (compare `updated_at` or a local version counter before clearing `dirty`).
- **Pull:** for each table, fetch rows with `server_updated_at` after the cursor (ordered by `server_updated_at`, then `id`, paginated), apply them locally, then advance the cursor.

Synced tables: `documents`, `reading_progress`, `bookmarks`, `highlights`, `settings`. Files and chapter text never move.

### 8.2 Detailed pull algorithm

```
for each table in [documents, reading_progress, bookmarks, highlights, settings]:
    cursor = sync_state['cursor:' + table] or epoch
    loop:
        rows = SELECT * FROM table
               WHERE (server_updated_at, id) > cursor
               ORDER BY server_updated_at ASC, id ASC
               LIMIT 500
        if rows is empty: break
        in one SQLite transaction:
            for row in rows:
                local = SELECT * FROM table WHERE id = row.id
                if local is null:
                    insert row (dirty = 0)          # for documents: local_uri = NULL ("Not on this device")
                else if local.dirty = 0:
                    overwrite synced columns (dirty = 0)   # keep local-only columns
                else:
                    resolve conflict by policy (see 8.4)
        cursor = (last row's server_updated_at, last row's id)
        save cursor
```

(`settings` has no `id`; use `key` in the cursor tuple.)

**Cursor pitfall:** if many rows share an identical `server_updated_at` (for example a bulk insert in one transaction), a strict `>` cursor on the timestamp alone with a page limit can skip rows. Use the compound `(server_updated_at, id)` cursor.

### 8.3 Detailed push algorithm

```
for each table (parents before children: documents first):
    rows = SELECT <synced columns> FROM table WHERE dirty = 1 AND sync_error IS NULL LIMIT 100
    if empty: continue
    snapshot each row's updated_at
    send rows via upsert
    on success, in a transaction:
        for each row:
            UPDATE table SET dirty = 0, server_updated_at = <returned>
            WHERE id = row.id AND updated_at = snapshot.updated_at
            # if updated_at changed meanwhile, leave dirty = 1 so it pushes again
    on failure: leave dirty = 1, schedule retry
```

Important details:
- **Order matters** because of foreign keys. Push `documents` before `bookmarks`/`highlights`/`reading_progress`.
- **Batch** requests to reduce round trips.
- **Idempotency:** upserts keyed by `id` make retries safe. A stale push is ignored by the server trigger (6.3), so retries cannot clobber newer data.
- **Partial failure:** handle each batch independently; one bad row must not block the rest forever. Quarantine permanently failing rows (for example a constraint violation) by setting `sync_error`, and surface them in logs.
- **Duplicate-hash conflict** (`23505` on `documents`): adopt the existing server row's `id` and re-point local child rows to it (see 6.1).

### 8.4 Conflict resolution implementation (latest wins everywhere)

Apply the policy table from section 2.6:

```ts
// conflict.ts (sketch)
export function resolve<T extends { updated_at: string }>(local: T, remote: T): T {
  const l = Date.parse(local.updated_at);
  const r = Date.parse(remote.updated_at);
  // Latest wins for every table, including reading_progress.
  // Ties go to the server copy, so all devices converge on the same row.
  // A tombstone (deleted_at set) newer than the other side's edit wins like any other row.
  return r >= l ? remote : local;
}
```

Be aware of **client clock skew**: a device with a wrong clock can win every conflict. Mitigations: the server trigger clamps `updated_at` values from the future (6.3), the pull cursor is server-assigned, and you can add per-row version counters later for stricter ordering.

### 8.5 Applying remote progress
- Pull can deliver a newer `reading_progress` row for a book. Apply it to SQLite like any other row.
- If the book is **closed**, the next open restores the newer position.
- If the book is **open** on this device, show the non-blocking "Jump to latest position?" prompt from 5.7 instead of moving the reader unprompted.
- If this device lacks the file (**"Not on this device"**), show the book-wide `percent` in the library and wait for the user to import the file.

### 8.6 Deletion handling
- Local delete sets `deleted_at` and `dirty = 1`; push sends the tombstone.
- Pull applies remote tombstones by setting `deleted_at` locally, then the UI hides the row and the app removes the local files (original, chapters, cover).
- Purge tombstones older than N days (for example 30 to 90) on both sides, after you are confident all devices have synced (or accept the small risk of resurrection from a very stale device).

### 8.7 Triggers for sync
Create a single `SyncScheduler` that debounces and coalesces requests:

| Trigger | Notes |
|---|---|
| App launch (if signed in) | Pull first so the library is fresh |
| App returns to foreground | Throttle (for example, not more than once per 30 to 60 s) |
| Connectivity regained | Use `@react-native-community/netinfo`; check `isInternetReachable`, not only `isConnected` |
| After local change | Debounced (for example 5 to 15 s after the last write); for progress, a longer debounce |
| App going to background | Best-effort quick push of pending progress |
| Manual "Sync now" | In Settings |
| Periodic | Optional (background fetch is limited and unreliable on mobile) |

Rules:
- **Only one sync run at a time** (a mutex or queue). If a trigger fires mid-sync, mark "run again after".
- Skip if signed out or offline.

### 8.8 Retry, backoff, and error handling
- Exponential backoff with jitter (for example 2s, 4s, 8s ... capped at several minutes).
- Distinguish error types:
  - **Network errors:** retry later silently.
  - **Auth errors (401/403):** refresh the session; if it fails, prompt re-login without blocking reading.
  - **Validation/constraint errors:** quarantine the row, log, don't retry endlessly.
  - **Server errors (5xx):** backoff and retry.
- Never lose local data on sync failure. Local state is always preserved.

### 8.9 Sync status UI
- States: *Not signed in*, *Synced*, *Syncing...*, *Offline (changes saved locally)*, *Error (tap for details)*
- Show "Last synced at ..." in Settings.
- Show a count of pending changes (rows with `dirty = 1`) for transparency and debugging.

### 8.10 Optional: Realtime
Supabase Realtime (Postgres Changes) can push updates from other devices instantly. For a reading app this is a nice-to-have: foreground/launch pulls are usually enough. If you add it, treat Realtime events only as a **hint to run a pull**, not as the data pipeline, so that missed events never cause permanent drift.

### 8.11 Observability
- A structured logger for sync runs (start, counts, duration, errors), with a hidden debug screen showing `sync_state`, cursors, and dirty counts.
- Error reporting (for example Sentry) with careful scrubbing of book text, snippets, and notes.

---

## 9. Phase 7: Testing and Hardening

### 9.1 Unit tests (highest value)
- **Normalization and offsets:** UTF-16 offsets with emoji and other characters outside the basic plane, combining marks (NFC), mixed line endings, BOM.
- **Position math:** global offset to (chapter, chunk, position) and back; book and chapter percentages; chapter boundaries; empty and one-character chapters.
- **Re-anchoring:** snippet found at the same place, shifted place, and not found.
- **EPUB extraction:** golden-file tests, where a fixed input EPUB must yield exactly the expected chapter text and offsets. Any change that breaks these requires bumping `normalization_version`.
- **Determinism:** run extraction twice (and, where possible, on two devices) and assert identical text and chapter offsets.
- **Library ordering:** recency calculation (latest of `last_opened_at`, `last_read_at`, `created_at`), fixed-mode sorts and filters, status derivation (unread, in progress, finished), and that `touchOpened` sets neither `dirty` nor `updated_at`.
- **Covers:** cover selection order, type detection by magic bytes, and fit rules for portrait, square, banner, and tiny images (5.2.1).
- **In-book search:** matching, snippet building, result cap, and history limits (5.6.1).
- **Reading style:** resolution of `reader.style` plus a per-book override, reset, and that a book's override survives a change to the default.
- Conflict resolution (latest wins, ties, tombstone vs edit)
- Cursor/pagination logic, including identical timestamps
- Push "clean only if unchanged" logic
- Migration runner (fresh install and upgrade from each previous version)

### 9.2 EPUB test corpus
Collect real files covering: EPUB 2 and EPUB 3; nested TOC; no TOC; TOC pointing to fragments; one huge spine file; hundreds of tiny spine files; image-only cover page; non-linear spine items; non-UTF-8 XML declarations; embedded fonts (obfuscated); DRM (must be rejected); fixed layout (must be rejected); malformed ZIP; CJK and right-to-left text; very large books (10 MB or more); uppercase `.EPUB` and non-ASCII, spaces, or `%` in file names; several `rootfile` entries; missing `mimetype`; ZIP64 or data-descriptor archives; `encryption.xml` listing only font obfuscation.

### 9.3 Integration tests
- Run the sync engine against a local Supabase instance (`supabase start`, needs Docker) with real RLS.
- Simulate two devices (two local DBs, one account): edit on both, sync in different orders, assert convergence, and that the **latest** progress wins.
- Verify idempotency by running push twice and replaying requests.
- Verify the "Not on this device" flow: device B receives a document, imports the matching file by hash, and resumes at the synced position.

### 9.4 Offline and failure scenarios (manual and automated)
- Airplane mode from first launch: everything works, including importing an EPUB.
- Network dropped mid-push and mid-pull: no corruption, no data loss, resumes correctly.
- Long offline period with many edits, then reconnect.
- App killed during import, during a write, or during sync (no half-imported books left behind).
- Token expired while offline, then reconnect.
- Clock skew on one device (set the system time wrong).
- Opening a book on a second device without reading must not overwrite the first device's newer position.
- Folder scan: nested folders, duplicates skipped by hash, permission denied, and access revoked later.
- Sign out, sign in as a different user.

### 9.5 Security tests
- With user B's token, try to read/modify user A's rows: all should fail.
- Confirm there is no way to access tables with the anon (unauthenticated) key.
- Confirm no service role key is in the app bundle.
- Review RLS with Supabase's security advisor/linter in the dashboard.

### 9.6 Performance tests
- Import and open large EPUBs and TXT files (10 MB, 50 MB, and pathological single-line files).
- PDF extraction time and memory on long documents.
- Low-end Android devices.
- Memory profiling during long scrolling sessions across many chapters.
- Library with thousands of documents/bookmarks.
- Sync of thousands of rows (pagination and batch sizes).

### 9.7 Device and OS matrix
- Multiple Android versions and manufacturers (file picker and permissions behave differently)
- iOS versions, iPhone and iPad if supported

---

## 10. Phase 8: Polish and Release

### 10.1 Product polish
- Onboarding (one or two screens explaining offline-first and optional sync)
- Empty states, error states (unsupported or DRM EPUB, scanned PDF, garbled TXT), and loading skeletons
- Haptics and subtle animations (do not add jank to scrolling)
- App icon, splash screen, and theming consistency
- Localization if relevant

### 10.2 Compliance and store requirements
- **Privacy policy** (required for Google OAuth verification and both stores); be explicit that book files and extracted text are stored on-device only, and that sync sends metadata, positions, short snippets, and notes.
- **Google OAuth consent screen verification:** apps requesting only basic profile/email scopes are usually straightforward, but publishing status ("Testing" vs "In production") affects who can sign in. Move to production before public release.
- **Apple:** if you offer third-party sign-in such as Google, check App Store review guidelines on login services (Sign in with Apple requirements have changed over time; verify the current rules before submitting).
- **Account deletion** flow in-app (required by both stores for apps with account creation).
- **Data safety / privacy nutrition labels:** declare accurately what is collected.

### 10.3 Release engineering
- EAS Build profiles: `development`, `preview`, `production`
- EAS Submit for store uploads; set up app signing (and register the correct SHA-1 with Google Cloud)
- EAS Update (OTA) for JS-only fixes, with care about native/runtime version compatibility. Remember that changing extraction rules in an OTA update means bumping `normalization_version`.
- Staged rollout / internal testing tracks (TestFlight, Play internal testing)
- Crash and error monitoring in production
- Separate dev and prod Supabase projects, with environment-specific config

### 10.4 Post-launch
- Monitor sync error rates and RLS denials
- Watch Supabase usage (database size, auth MAUs, egress)
- Plan for data schema evolution: add columns in backward-compatible ways, since old app versions will talk to the new schema for a while

---

## 11. Risks and Pitfalls

| Risk | Mitigation |
|---|---|
| Forgetting to set `dirty` / `updated_at` on some write path | Route all writes through repositories; add tests |
| Sync clobbers newer data | Server-side latest-wins trigger; tests with two simulated devices |
| Merely opening a book overwrites a newer position from another device | Write progress only after real movement (5.7); test it (9.4) |
| Opening a book marks the document dirty (sync churn, metadata overwrites) | `last_opened_at` is local-only; `touchOpened` never sets `dirty` or `updated_at` |
| Folder scan or picker silently misses some EPUBs | Case-insensitive name match, content validation, tolerant parser, per-file `ImportReport` and `import_log` (5.1.1) |
| Covers drawn cropped or stretched | Normalize at import, store dimensions, and fit by ratio (5.2.1) |
| Large chapters exceed the device rendering budget | Profile the windowed reader (5.6) on low-end phones |
| Per-book style rows left behind after a book is deleted | Purge `reader.book.<documentId>` locally on delete; the rows are tiny |
| Expecting a blanket "storage permission" to expose all files on Android | Offer manual import plus a folder-based scan (Storage Access Framework); hide scan on iOS (5.1) |
| Clock skew breaks last-write-wins | Server-assigned cursor; clamp future timestamps; consider version counters |
| Cursor skipping rows with identical timestamps | Compound `(timestamp, id)` cursor |
| Offsets differ between devices (non-deterministic extraction) | Deterministic rules, golden-file tests, versioned `normalization_version`, pinned parsing libraries |
| Offsets shift after extraction rules change | Bump `normalization_version`; re-anchor with chapter index, chapter offset, and snippet |
| Offsets counted in the wrong unit (bytes, code points) | Always UTF-16 code units; unit tests with emoji |
| EPUB with one huge or hundreds of tiny spine items makes chapter percentage meaningless | v1 uses spine items; later group by TOC entries (5.2) |
| DRM or fixed-layout EPUBs | Detect on import and show a clear message |
| EPUB parsing too slow or memory-heavy on big books | Lazy unzip, one chapter at a time, write to disk, yield to the UI, progress indicator |
| PDF extraction quality (scanned, multi-column) | Label PDF as best-effort; show "No readable text found"; offer opening in another app |
| pdf.js in a WebView fails offline or differs by platform | Spike early; bundle assets locally; pin the pdf.js version |
| Large files freeze the UI | Chunked/virtualized rendering, lazy loading, chunk index |
| Pure-JS library missing a Hermes API (for example text decoding) | Spike on a device in Expo Go before committing to a library |
| Same book imported on two devices creates duplicate rows | Unique `(user_id, content_hash)` plus adopt-existing-id handling (8.3) |
| Different file attached to a "Not on this device" record | Verify the hash before attaching (2.3) |
| Snippets and notes sync book text | Keep snippets short; disclose in the privacy policy |
| Android Google sign-in `DEVELOPER_ERROR` | Verify package name, SHA-1 for every signing key (debug, EAS, Play) |
| Importing a native-only module (Google Sign-In) while running in Expo Go | Install it only in Phase 5 and switch to an EAS development build at the same time |
| Local Android builds failing on Windows (missing SDK/JDK, long paths, spaces in the project path) | Use Expo Go and EAS cloud builds; if building locally, use a short path such as `C:\dev\reader` and enable long paths |
| `expo-sqlite` bundling error on web (`wa-sqlite.wasm` not resolved) | Do not run the web target; v1 is mobile only |
| `supabase db push` targeting the local Docker stack instead of the hosted project | Run `npx supabase db push --remote` after linking |
| Session lost when offline | Don't sign out on network errors; only on explicit auth failures |
| Missing RLS on a new table | Enable RLS in every migration; use the Supabase linter; CI check |
| Service role key leaked in the app | Only the anon key in the client; privileged work in Edge Functions |
| User switches accounts on one device | Track `user_id` in `sync_state`; prompt and clear/merge deliberately |
| Tombstones resurrect deleted data | Keep tombstones long enough; purge conservatively |
| Over-engineering sync early | Ship the offline reader first; add sync after the local layer is stable |

---

## 12. Suggested Milestones

| Milestone | Deliverable | Status | Remaining |
|---|---|---|---|
| **M0** | Decisions documented | ✅ Done | None |
| **M1** | Project scaffold | 🟡 Partial | Runs in Expo Go and Supabase is linked. CI is not set up. |
| **M2** | Local data layer | 🟡 Partial | Migrations and repositories done. Reactive reads are minimal and there are no unit tests yet. |
| **M3** | Text model and TXT slice | ✅ Done | Add position-math and normalization tests. |
| **M4** | **EPUB reader (primary)** | 🟢 Advanced | Import, covers, TOC, library, settings, per-book style, and progress are done. Windowed rendering, import recovery and legacy cover repair implemented. Device profiling and extraction golden files remain. |
| **M4b** | **Reader screen parity** | Partial | Contents panel, display popup, incremental search and scrubber implemented. Paged flow remains. |
| **M5** | PDF and annotations | ⬜ Not started | pdf.js extraction spike; highlight and note UI and storage. |
| **M6** | Backend | 🟡 Partial | SQL is written. Verify RLS, triggers, and the cross-user test against the live project. |
| **M7** | Google sign-in | ⬜ Not started | EAS development build, sign in and out, optional-auth flows. |
| **M8** | Sync v1 | ⬜ Not started | Push/pull, "Not on this device", status UI, two-device test. |
| **M9** | Hardening | Partial | Large-book regression tests and Android emulator coverage are in place. Profile release builds on lower-end physical devices and expand the EPUB corpus (9.2). |
| **M10** | Beta | ⬜ Not started | TestFlight / Play internal testing. |
| **M11** | Release | ⬜ Not started | Store submission, monitoring, rollback plan. |

---

## 13. Concise Project Initialization Steps

### A. Phases 1 to 4: Expo Go (no native toolchain)

```bash
# 1. Create the Expo app (TypeScript + Expo Router default template)
npx create-expo-app@latest sirum
cd sirum

# 2. Dependencies for the local database, import, and Supabase client
npx expo install expo-sqlite expo-file-system expo-document-picker \
  expo-crypto expo-keep-awake @react-native-async-storage/async-storage
npm install @supabase/supabase-js react-native-url-polyfill

# 3. Environment file (never commit)
cat > .env <<'EOF'
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EOF
echo ".env*" >> .gitignore

# 4. Supabase CLI and project
npx supabase init
npx supabase login
npx supabase link --project-ref <your-dev-project-ref>
npx supabase migration new init_schema     # paste the schema SQL here
npx supabase db push --remote              # --remote targets the linked hosted project

# 5. Run in Expo Go (install Expo Go on your phone first)
npx expo start -c                          # scan the QR code; do not press "w"
```

Notes:
- Recent Supabase CLI versions default to the local Docker stack. `--remote` sends the migration to your hosted project instead.
- You can also paste the schema SQL into the Supabase **SQL Editor**. If you later use the CLI, run `npx supabase migration repair --status applied <timestamp>` so `db push` does not apply it twice.
- Keep `/android` and `/ios` in `.gitignore`. They are generated folders.
- Set the app name in `app.json`: `"name": "Sirum"` and `"slug": "sirum"`. Choose the Android `package` and iOS `bundleIdentifier` early (for example `com.yourname.sirum`), because Google OAuth is tied to them and they cannot be changed after you publish.

### B. Phase 3 additions: EPUB and PDF support (still Expo Go)

Install these when you start the EPUB milestone (M4) and the PDF milestone (M5):

```bash
# EPUB (pure JavaScript, runs in Expo Go)
npm install fflate fast-xml-parser htmlparser2

# PDF text extraction host (when you reach M5)
npx expo install react-native-webview
```

Before committing to these libraries, spike each on a real device in Expo Go (unzip a sample EPUB, parse its OPF, extract one chapter to text).

### C. Phase 5: switch to a development build (Google sign-in)

```bash
# 1. Native packages (Expo Go cannot run these)
npx expo install expo-dev-client expo-secure-store
npm install @react-native-google-signin/google-signin

# 2. Cloud build, no local Android SDK or JDK required
npm install -g eas-cli
eas login
eas build:configure
eas build --profile development --platform android

# 3. Install the APK on your phone, then:
npx expo start --dev-client
```

Phase 6 also needs `npx expo install @react-native-community/netinfo`.

Then:
1. Set `package` / `bundleIdentifier` in `app.json`, and add the Google Sign-In config plugin per the library docs.
2. Get the signing key SHA-1 with `eas credentials` and add it to the Android OAuth client in Google Cloud.
3. Create the folder structure from section 3.2 and build Phases 2 and 3 before touching auth or sync.

---

*End of plan.*
