# Sirum: Development Progress

Tracks implementation status against `offline-reader-dev-plan.md`. Update this file as milestones complete.

**Last updated:** 2026-11-19

---

## Status Overview

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Scope & decisions | ✅ Done | All decisions locked in the plan doc |
| Phase 1: Project setup | 🟡 Partial | Expo/TS/Router app exists; NativeWind added; folder structure in place |
| Phase 2: Local-first data layer | 🟡 Partial | Schema, migrations, repositories exist; sync columns in place; reactive reads minimal |
| Phase 3: Core reading (offline) | 🟢 Advanced | **TXT and EPUB parsing & reading fully implemented**; library UI refined; PDF text extraction pending |
| Phase 4: Supabase backend | 🟡 Partial | Migrations written (`supabase/migrations/`); not verified against a live project |
| Phase 5: Google auth | ⬜ Not started | `expo-secure-store`, supabase-js installed; no native sign-in yet |
| Phase 6: Sync engine | ⬜ Not started | Schema supports it; no push/pull code |
| Phase 7: Testing & hardening | ⬜ Not started | — |
| Phase 8: Polish & release | ⬜ Not started | — |

Legend: ✅ done · 🟢 advanced / nearly done · 🟡 partial · ⬜ not started

---

## Recent Updates (2026-11-19)

### 1. EPUB File Scanning & Staging Bug Fix
- **Issue:** Scanning on Android resulted in `ExponentFileSystem.copyAsync has been rejected -> caused by java.io.IOException`.
- **Root Cause:** 
  1. SAF directory scanning in `ImportScreen.tsx` returned full content URIs. Appending `${uri}/${name}` caused double-concatenated malformed URIs.
  2. Native Android `FileSystem.copyAsync` throws `java.io.IOException` on certain SAF document / content provider URIs.
- **Fix:**
  - Fixed `scanTree()` in `src/features/library/ImportScreen.tsx` to directly traverse and probe child URIs returned by `readDirectoryAsync()`.
  - Implemented multi-strategy `stageFile(sourceUri, targetUri)` in `src/features/library/importer.ts`: attempts `copyAsync` first, then falls back to Base64 chunked stream copying (`readAsStringAsync` / `StorageAccessFramework.readAsStringAsync` -> `writeAsStringAsync`).
  - Added permissive MIME types to document picker (`application/octet-stream`, `*/*`, etc.) so Android file pickers never hide `.epub` files.

### 2. Full Pure-JS EPUB Import & Parsing Pipeline
- Implemented `src/formats/epub/importEpub.ts` using `fflate`, `fast-xml-parser`, and `htmlparser2`:
  - **ZIP Archive Handling:** Unzips entries synchronously and normalizes internal path structures.
  - **DRM & Fixed-Layout Detection:** Detects `META-INF/encryption.xml` and blocks non-obfuscated DRM; detects `rendition:layout="pre-paginated"` and surfaces a clear unsupported message.
  - **OPF & Metadata:** Reads `container.xml` to locate OPF, parses title, author, manifest, and spine reading order.
  - **Cover Art Extraction:** Locates cover images via EPUB 3 `cover-image` properties, EPUB 2 `<meta name="cover">`, or image manifest fallbacks, saving raw cover bytes locally to `${bookDir}/cover.jpg`.
  - **TOC & Normalization:** Resolves EPUB 3 nav and EPUB 2 NCX hierarchies for accurate chapter titles; strips HTML boilerplate while preserving block boundaries, decoded entities, and normalized UTF-16 chapter text.

### 3. Library Page Redesign & Book Styling
- **Refined Book Presentation (`src/components/ui/book.tsx`):**
  - Upgraded covers to a standard 2:3 aspect ratio with realistic 3D book spine groove highlights and elevation shadows.
  - Support for real extracted cover art (`cover_uri`) with graceful fallback.
  - Added curated luxury fallback palettes (Deep Slate, Oxford Blue, Emerald, Burgundy Wine, Royal Plum, Amber Leather, Espresso, Indigo, Charcoal) with embossed book icons and serif typography.
  - Removed clashing pastel pink/green badges and out-of-place play button badges; introduced sleek frosted glass format badges (`EPUB`, `TXT`) and thin reading progress indicators.
  - Polished both 2/3/4-column grid cards and list rows.
- **Refined Library Screen (`src/features/library/LibraryScreen.tsx`):**
  - Replaced rough tab styling with native pill tabs with counts.
  - Added an inviting empty state card with a book icon, guidance copy, and an "Import Books" action button.
  - Polished search input with instant clear action.

### 4. Page Transition Optimization
- Updated `src/app/_layout.tsx` with smooth screen animations:
  - **Tab-level views** (`/`, `/history`, `/import`, `/settings`): `animation: 'fade'` (180ms) for natural tab switching.
  - **Sub-settings pages** (`settings-*`): `animation: 'slide_from_right'` (220ms) for hierarchical drill-down navigation.
  - **Reader view** (`reader/[id]`): `animation: 'slide_from_bottom'` (260ms) for an immersive book-opening transition.

---

## What Was Built (UI Prototype Implementation)

The screens, layout, and interactions from `sirum-ui-prototype.html` are implemented as real app screens with **NativeWind v4** styling and live SQLite-backed settings.

### Screens & routes (`src/app/`)

| Route | Screen | Prototype equivalent |
|---|---|---|
| `/` (`index.tsx`) | Library | Library screen |
| `/history` | History | History screen |
| `/import` | Import | Import screen (scan + manual) |
| `/settings` | Settings hub | Settings category list |
| `/settings-appearance` | Appearance | Theme / accent / app font |
| `/settings-library` | Library settings | Nav layout, default layout, order, badges, details |
| `/settings-reader` | Reader settings | Progress display + reading style editor + preview |
| `/settings-import` | Import & storage | Import method + storage access |
| `/settings-sync` | Sync | Account section (sign-in disabled until Phase 5) |
| `/settings-about` | About | Version / privacy / licenses |
| `/reader/[id]` | Reader | Reader + "Aa" display sheet |

### Shared chrome (`src/components/`)

- `chrome/app-bar.tsx` — `Screen` wrapper, `AppBar`, `BottomNav`, `SideDrawer`, `ChromeProvider` (drawer + toast).
- `ui/icon.tsx` — theme-aware Ionicons wrapper + `IconButton`.
- `ui/book.tsx` — `BookCover` (cover image + luxury fallback gradient + 3D spine), `BookBadges`, `BookCard` (2-col detailed / 3–4-col compact styles), `BookRow`.
- `ui/controls.tsx` — `Chip`, `SegmentedControl`, `Section`, `SectionLabel`, `SliderRow`, `ColorSwatches`, `PrimaryButton`.
- `ui/sheet.tsx` — `BottomSheet` (Modal bottom sheet).

### Feature code (`src/features/`)

- `library/LibraryScreen.tsx` — grid/list views, search, format tabs, filter sheet, ordering modes, ask-once order prompt, polished empty state.
- `library/HistoryScreen.tsx` — books with progress, sorted by last read.
- `library/ImportScreen.tsx` — scan/manual panels, SAF folder scan (Android), document picker.
- `library/importer.ts` — resilient import pipeline: sandbox copy/stream staging → SHA-256 → dedupe → extract (TXT + EPUB) → cover extraction → DB.
- `settings/SettingsProvider.tsx` — loads all settings into memory; typed getters/setters; stable object identity.
- `settings/*Settings.tsx` + `SettingsPage.tsx` + `SettingsHubScreen.tsx`.
- `reader/ReaderScreen.tsx` — chapter rendering, progress footer, Aa sheet with All-books/This-book scope, per-book overrides, position restore, debounced progress writes, keep-awake, ask-once percentage prompt.
- `reader/ReadingStyleEditor.tsx` — shared style editor + live preview.

### Theming (`src/theme/`)

- `palette.ts` — dark/light/sepia palettes + green/purple/blue accents as RGB triples.
- `ThemeProvider.tsx` — resolves `device.theme`/`accent`/`appFont`, injects CSS vars via NativeWind `vars()`.

### Data layer changes

- `lib/settingsKeys.ts` — all prototype keys added (`device.*`, `reader.style`, `reader.book.<id>` helpers, types, defaults).
- `db/repositories/settings.ts` — `listAll`, `getRaw`, `setRaw` (device-local keys write `dirty = 0`), `remove`.
- `db/repositories/documents.ts` — `list()` now JOINs `reading_progress` (percent, last_read_at), supports search, format/status filters, `recent` (recency = max of last_opened_at/last_read_at/created_at) and `fixed` sort modes.
- `db/repositories/chapters.ts` — fixed table name (`document_chapters`).
- `formats/txt/importTxt.ts` — TXT → single normalized chapter.
- `formats/epub/importEpub.ts` — EPUB 2/3 archive parsing, metadata, cover image, TOC, DRM detection, and normalized text extraction.

### Config & Dependencies

- Added `fflate`, `fast-xml-parser`, `htmlparser2`.
- NativeWind: `global.css`, `tailwind.config.js`, `babel.config.js`, `metro.config.js`, `nativewind-env.d.ts`.
- ESLint flat config installed (`eslint.config.js`); `npx tsc --noEmit` and `npx eslint` pass cleanly with 0 errors.

---

## Prototype Feature Checklist

| Feature | Status | Notes |
|---|---|---|
| Bottom tab bar nav | ✅ | Library / History / Import / Settings |
| Side drawer nav | ✅ | Same destinations + format items |
| Library grid 2/3/4 cols | ✅ | View + grid size in filter sheet; refined 2:3 card styling |
| List view | ✅ | Rows with cover, progress bar, percent |
| Caption vs overlay card styles | ✅ | 2 cols = detailed caption, 3–4 = compact overlay title |
| Show/hide badges & details | ✅ | `device.showBadges`, `device.showDetails` |
| Search title/author | ✅ | Toggle in app bar with instant clear |
| Format tabs + counts | ✅ | Bottom mode; drawer items in side mode |
| Filter sheet (view/sort/grid/format/status) | ✅ | Sort disabled in `recent` order mode |
| Library order recent vs fixed | ✅ | Recency SQL per plan; ask-once prompt |
| History screen | ✅ | Progress books by last read |
| Import: manual picker | ✅ | `.txt` and `.epub` import fully; `.pdf` reported unsupported |
| Import: device scan (Android) | ✅ | SAF folder pick, recursive scan, resilient staging |
| EPUB import & reading | ✅ | Pure-JS extraction (`fflate`, `fast-xml-parser`, `htmlparser2`) |
| Settings hub + 6 sub-pages | ✅ | All prototype categories |
| Appearance theme/accent/app font | ✅ | Runtime CSS vars, live switch |
| Reader screen | ✅ | TXT and EPUB books readable end-to-end |
| Reader "Aa" display sheet | ✅ | Scope all/book, presets, sliders, swatches, reset |
| Per-book style overrides | ✅ | `reader.book.<id>` synced keys |
| Progress display book/chapter | ✅ | Footer label + ask-once prompt |
| Progress save/restore | ✅ | Debounced writes, restore on open, no write-on-open |
| Toasts | ✅ | Global via ChromeProvider |
| Ask-once prompts (order, percentage) | ✅ | Added per plan (not in prototype) |

---

## Plan Milestones vs. Reality

| Milestone | Plan exit criteria | Status |
|---|---|---|
| M0 Decisions | Documented | ✅ `offline-reader-dev-plan.md` |
| M1 Scaffold | Runs in Expo Go, CI green, Supabase linked | 🟡 Runs & bundles; Supabase linked (`supabase/.temp/linked-project.json`) |
| M2 Data layer | Migrations + repos + tests | 🟡 Migrations & repos done; no tests yet |
| M3 TXT slice | Import/read/save/restore TXT offline | ✅ Implemented and verified |
| M4 EPUB reader | Full EPUB pipeline + UI features | ✅ Full EPUB extraction (OPF, TOC, covers, DRM detection) & redesigned UI |
| M5 PDF + annotations | pdf.js extraction; bookmarks/highlights/notes | ⬜ Not started |
| M6 Backend | Schema + RLS + triggers verified | 🟡 SQL written, unverified |
| M7 Google sign-in | EAS dev build, sign in/out | ⬜ Not started |
| M8 Sync v1 | Push/pull, "Not on this device", two-device test | ⬜ Not started |
| M9 Hardening | Offline/failure/security/perf tests | ⬜ Not started |
| M10–M11 Beta/Release | — | ⬜ Not started |

---

## Known Gaps & Next Steps

### Immediate (Phase 3 remaining)

1. **PDF importer** — `react-native-webview` + pdf.js spike per plan 5.4.
2. **Reactive reads** — repository change notifications so library updates without focus reloads (plan 4.6).
3. **Bookmarks/highlights/notes UI** — repos exist (`bookmarks.ts`); no UI yet (plan 5.11).
4. **Chapter navigation drawer** in reader (TOC, prev/next) — plan 5.6.
5. **Chunked virtualized rendering** for very large books — currently renders all chapter text in one ScrollView.
