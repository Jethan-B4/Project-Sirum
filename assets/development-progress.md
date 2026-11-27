# Sirum: Development Progress

Tracks implementation status against `offline-reader-dev-plan.md`. Update this file as milestones complete.

**Last updated:** 2026-11-27

---

## Reader navigation and display refinements (2026-11-27)

- Chapter navigation now commits the active chapter and prepared page as one state update, avoiding an interim loading render after a swipe. Backward swipes and edge turns open the previous chapter at its end; forward turns still open at the beginning.
- A short native tap recognizer now toggles reader controls from the center as well as respecting edge-turn gestures, while vertical scrolling and interactive links retain their handlers.
- Reader settings can hide or show the chapter count beside chapter progress. The reader display popup now changes the current book only; all-book defaults stay in Settings. EPUB semantic headings are detected and can override publisher alignment and underline per book, with publisher formatting as the default.
- Regression tests cover simple/detailed progress labels and backward chapter destinations. Physical-device gesture feel and heading rendering still need verification.

## EPUB archive import limits (2026-11-27)

- EPUB imports reject absolute, traversal, NUL-containing and duplicate normalized ZIP paths. Compressed archives are capped at 256 MiB, individual expanded entries at 64 MiB, total declared expanded content at 512 MiB, and selected extracted content at 256 MiB.
- XML parsing disables entity processing and rejects `DOCTYPE` declarations in package, container and navigation documents.
- Regression tests cover path normalization, traversal and duplicate rejection, and expanded-size budgets.

## Haptics, library cover fit & update hardening (2026-11-27)

- **Haptics (`src/lib/haptics.ts`):** new `expo-haptics` helper exposing `select` / `impact` / `success` / `warning`. Every call is best-effort — it no-ops on web and never surfaces a failure. Wired into the reader (chapter and page turns `impact`; bookmark/highlight add and undo `success`; bookmark, highlight and selection deletion `warning`) and the library (long-press to open the delete dialog `select`; confirmed removal `warning`; undo `success`).
- **Toast screen-reader announcements:** `useChrome().toast` now calls `AccessibilityInfo.announceForAccessibility`, including the Undo action label, so confirmations and failures reach screen reader users rather than staying purely visual. `BookCard`/`BookRow` already carried full labels.
- **Library cover fit (`BookCover`):** now honors the stored intrinsic `documents.cover_width`/`cover_height` and the `device.coverFit` setting. Art within ±8% of the 2:3 frame fills the frame; other art is shown whole (`contentFit="contain"`) over a blurred, dimmed copy of itself; `device.coverFit = 'crop'` forces crop-fill. `BookCard` and `BookRow` pass the stored dimensions, making Settings → Library → Cover fit functional.
- **Document update safety:** `documents.update` now writes only an allowlisted set of metadata columns (`UPDATABLE_COLUMNS`). Unknown patch keys — e.g. from a future synced payload — are ignored instead of being interpolated directly as SQL identifiers, mirroring the highlights `color`/`note` allowlist.
- **Validation:** `npx tsc --noEmit` clean, `npx expo lint` clean, 29/29 reader regression tests pass.

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
| Phase 7: Testing & hardening | Partial | Reader, link extraction, import recovery and large-book search regressions covered. Production crash logger with sensitive-data sanitization active. Physical-device profiling, archive limits, and secure session storage remain open. |
| Phase 8: Polish & release | 🟢 Advanced | Adaptive Library, reader controls, confirmed library delete with undo, first-run offline onboarding, and screen reader accessibility implemented. Production package size check in place. Backup disclosure and store privacy requirements are still open. |

Legend: ✅ done · 🟢 advanced / nearly done · 🟡 partial · ⬜ not started

## Library deletion with undo, onboarding, accessibility & crash logging (2026-11-26)

- **Library delete action with undo (plan 5.9):** Long-pressing any book card or list row opens a confirmation modal ("Remove from library?"). Confirming invokes `documents.softDelete(id)` and raises a 5-second toast with an **Undo** action. Tapping **Undo** invokes `documents.restore(id)` to immediately restore the book without re-import. Book files remain on device during the undo window and are retained until sync can commit the tombstone.
- **Undo for bookmarks and highlights:** Deleting a bookmark or highlight in the reader's `ContentsPanel` and selection popup now triggers an undoable toast. Tapping **Undo** executes `bookmarks.restore(id)` or `highlights.restore(id)` to restore the record and refreshes the annotations list.
- **First-run offline onboarding:** On initial launch (`device.onboardingSeen = false`), a modal welcomes users and highlights Sirum's three pillars: 100% offline-by-default reading, optional sign-in (exclusively for multi-device sync), and zero tracking or reading surveillance. Tapping **Get Started** sets `device.onboardingSeen = true` and transitions cleanly to the library, gracefully sequencing before the ask-once library order prompt.
- **Screen reader accessibility:** `BookCard` and `BookRow` now announce comprehensive accessibility labels (`"${title}, by ${author}, ${format} format, ${progress}% read${remoteText}"`) and provide `accessibilityHint` for tap-to-read and double-tap-and-hold options, resolving the gap where screen readers announced titles only.
- **Production crash logging & data sanitization:** `src/lib/logger.ts` implements a ring buffer of 50 breadcrumbs for production crash reporting (`getCrashBreadcrumbs()`). A recursive `sanitize()` utility redacts sensitive data (local file URIs, book text, snippets, passages, notes, and authentication tokens) to guarantee that future crash reporting cannot leak user books or credentials. Replaced unhandled `console.error` and `console.warn` calls with `logger.error` and `logger.warn`.
- **Validation:** All 24 regression tests pass in Node. TypeScript (`npx tsc --noEmit`) and ESLint (`npx eslint`) pass with zero errors.

## Reader text selection, highlights and notes (2026-11-25)

- Long-pressing selectable passage text opens a reader-themed toolbar while retaining the platform's native selection affordances; tapping a saved highlight reopens its actions. The toolbar offers current-chapter Select All, Copy, OS Share, online Search and More/device-app actions.
- Colored highlights (and optional underline) persist in the existing highlight color field; the X removes a saved highlight, and colorless selections/notes are never persisted as highlights. Saved styling renders in the passage, with a dotted underline for note-bearing text.
- The selection toolbar stays near the touched passage and displays the full excerpt in a scrollable preview. The Annotations tab labels the excerpt and note separately, includes the chapter and color, and provides note editing/deletion without overlapping the passage text.
- Added `expo-clipboard` at the SDK 58-compatible version for Copy. Regression tests cover Unicode word selection and highlight-style encoding. Physical-device verification of native selection handles, toolbar coexistence, and share targets remains open.

## Reader links, responsiveness and touch feedback (2026-11-25)

- Hyperlinks open a themed preview showing the link label and the complete destination paragraph, with **Continue reading** and **Go to passage** actions. External links show their address and require an explicit **Open link** action; unavailable destinations remain dismissible in the same popup.
- The reader caches the current and adjacent chapter loads so horizontal swipes and chapter navigation can reuse prepared text and EPUB navigation data. Cache failures remain retryable and are reported if the user requests that chapter.
- Primary app navigation was set to be immediate (no stacked-screen animation) to avoid a transition flash. *(Superseded 2026-11-27: slide transitions were re-enabled with a light cross-fade — see Page Transition Optimization.)* Shared buttons and navigation controls now have consistent pressed-state scale and opacity feedback; the reader's **Next chapter** control clips its Android ripple to its rounded shape.
- Validation passed: 19 reader regression tests, Expo lint, `npx tsc --noEmit`, and an Android Expo bundle export. Physical-device touch feel and frame-pacing verification remains open.

---

## Reader gestures, settings navigation and paragraph indents (2026-11-24)

- Horizontal swipes now open the previous or next chapter at its beginning in all three flows. Paged edge taps still advance within the current chapter. Vertical flings have a continuous scroll extent through the chapter footer.
- Aa → Layout and Settings → Reader share the progress-bar preference. The thumb, percentage and seek destination follow the selected book or chapter. The chapter-end button sits at the trailing text margin with a contrasting label, arrow and outline.
- The Android screenshot in `local/Screenshot_2026-11-24-17-41-03-234_host.exp.exponent.jpg` and the local *Catching Fire* EPUB show a two-line part title authored as centered paragraphs with enlarged spans. Presentation cache v5 preserves that alignment on existing imports and the renderer reserves line height for the larger type.

- Horizontal swipes preview the destination at the finger position. Slide reveals the adjacent passage side by side, and Fade blends the two. Reversing a short drag cancels the turn. Reading progress changes on commit. Edge taps can be turned off independently under Settings → Reader.
- Aa, More and Contents leave the exposed book interactive. Opening Settings from the book hides the app's bottom navigation on the settings hub and its category screens. Back returns to the open book.
- Aa → Text and Settings → Reader offer first-line indents from 1 to 4 em, with a 2 em initial length and indentation off by default. The display preference supports book-specific overrides. EPUB headings, list markers, hard-cut paragraph continuations and stored text offsets retain their existing behavior.
- On the Android API 37 emulator, the chapter slider reached 51% within Part I of *Catching Fire*. After switching to Whole book in Aa → Layout, the same slider position reached 51% of the book in Chapter 14. In Paged flow, a left swipe opened Chapter 15 at its opening illustration and a right swipe returned to the opening of Chapter 14. Both lines of the Part I title were centered within one pixel of the 1080-pixel screen midpoint.
- Earlier emulator checks covered the held chapter preview, cancellation, swiping outside an open Aa panel, reader settings navigation, disabling edge taps and applying a four-em first-line indent.

## Reader layout and transitions (2026-11-24)

- Covers occupy the reader viewport in portrait and landscape. The same layout handles a separate library cover and an image-only first spine item. The reader displays EPUB headings in the passage and the chapter's contents label in the compact progress bar.
- EPUB presentation version 4 records heading alignment, small caps, constrained width, bottom rules and hidden heading labels. Presentation can be rebuilt from the saved EPUB while retaining canonical text offsets.
- Reader settings control the Next chapter button and the style and speed of chapter and page turns. The toolbar, footer and reader panels animate on the native driver. System Reduce Motion takes precedence. Paged flow advances by roughly a screen with overlap, and Auto enables page turns on wide screens.
- **Local references.** The ignored `local/` directory holds three Expo Go screenshots of Sirum and one comparison-reader screenshot dated November 24. Use them to compare the cover landing, the “Chapter 1: Crimson” heading, toolbar height and progress footer. It also contains the Library and Reader HTML prototypes, five EPUB fixtures (Lord of the Mysteries and four Overgeared editions), and a PDF sample. These are developer test materials and stay outside the app package.
- On the Android API 37 emulator, an EPUB with an image-only opening chapter filled the 1080 × 2400 portrait and 2400 × 1080 landscape viewport. A page turn advanced from passage 0 to passage 11 and returned to passage 0. A vertical drag hid the controls. The Hide, Slide and Slow choices persisted after leaving settings, and enabling the button again opened the expected chapter. The local Lord of the Mysteries stylesheet produced a centered, small-cap heading with an 80% width limit and a two-pixel bottom rule.
- Expo Go's manual picker returned a cached file URI it could not read during this check. Android folder scan imported the same test EPUB successfully. Physical-device frame timing and iOS interaction are still pending.

## Publisher spacing and nested lists (2026-11-24)

- EPUB stylesheets can use direct-child selectors such as `ol.steps > li` to format one list level. These selectors also work alongside descendant selectors in the same rule.
- A quotation or list can set the space above its first paragraph and below its last. Nested margins use the largest adjoining gap. Stored books rebuild this presentation from their local EPUB when the extracted chapter text matches the saved text.
- Regression fixtures cover nested lists, quotations and mixed selectors. A check of 25 chapters across five local EPUBs verified that rendered rows reconstruct the extracted text and that link and style ranges stay inside it. A simulated storage check covered simultaneous cache upgrades and fallback to the previous formatting when saved text differs.

## Paragraphs and lists in the reader (2026-11-23)

- Reflowable EPUB chapters and linked sections preserve paragraph gaps, common CSS block margins, explicit blank lines, nested list indentation and block quotations. List markers include bullets, decimal, alphabetic and Roman numbering. Wrapped text aligns beneath the item text.
- Presentation data uses the existing chapter offsets. Older local EPUBs rebuild the new data from their saved original. TXT keeps the author's internal blank lines, indentation and literal list symbols.
- Rendering groups up to 40 paragraph starts per text chunk. Regression fixtures cover paragraph margins, consecutive line breaks, nested and restarted lists, links, TXT whitespace and a reversed list of 601 items.

## Reader overlays and illustrated EPUBs (2026-11-23)

- The toolbar and progress bar overlay the reading surface. Their visibility preserves the scroll viewport, line breaks and passage position. Fixed space at the beginning and end of the chapter keeps the first and last lines reachable.
- **Aa** and **More** share a toolbar-aligned popup. The display panel groups settings under **Text**, **Colors** and **Layout** and keeps its title and close action visible while controls scroll.
- The EPUB reader applies supported publisher typography and shows local illustrations in reading order. Headings, emphasis, relative type sizes, underlines and strikethroughs coexist with the reader's base font, colors and line spacing. Embedded images retain alternative text and confirmed links. New imports retain image-only sections.
- Presentation data is stored separately from normalized text. Earlier imports can rebuild it from the local EPUB while preserving saved chapter indexes and character offsets. Image-only sections skipped by the earlier importer can still open through an in-book link.
- On an Android API 37 emulator, a local illustrated EPUB showed its embedded PNG at the correct aspect ratio. The image and the following link kept identical screen coordinates through a hide/show cycle. Confirming the link opened the image-only chapter. An EPUB imported under the earlier reader recovered its illustration after upgrading and opened a previously skipped page as a linked section. In landscape, the display panel scrolled while its close button stayed in place. Expo lint, TypeScript, ten reader regressions and both mobile bundle exports passed. iOS device interaction remains unverified.

## Reader controls and chapter gestures (2026-11-23)

- **Aa** now exposes line height in 0.1× steps from 1.2× to 2.2×. It shares the Reader settings control and supports both the default style and per-book overrides.
- A tap on the reading surface toggles the toolbar and progress bar. A vertical drag hides both and a tap brings them back. The chapter stays mounted, and the controls remain available when a screen reader is active.
- A deliberate left swipe opens the next chapter and a right swipe opens the previous one. Both use the existing chapter navigation and position-saving path. A swipe past either end leaves the reader in place.
- Verified on an Android API 37 emulator with a 600-chapter EPUB and the updated JavaScript bundle in a test-signed copy of the app. Checks covered tap-to-toggle, auto-hide during vertical scrolling, link confirmation, both swipe directions, and the first and last chapter boundaries. A per-book line height of 2.2× persisted after reopening while the default stayed at 1.6×. Expo lint, TypeScript, all eight reader regressions, and the iOS bundle export passed. iOS touch behavior still needs a device check.

## Adaptive layouts, History search and reader links (2026-11-23)

- Library category labels and counts, including zero, use native theme colors. Selected controls choose a foreground based on the fill color. Rotating the device updates the grid and reader layout. Display settings and the Library order prompt scroll in short viewports.
- History searches titles, authors and saved chapter names. Results retain the History screen's selected reading-status filter and last-read order. Closing search restores the list.
- EPUB import saves each hyperlink's visible label range and each named anchor alongside the normalized chapter. Previously imported books rebuild this data from their local original when needed. Tapping a blue, underlined link displays the destination and offers a choice to proceed or cancel. Internal jumps resolve the chapter and anchor. An off-spine footnote opens separately so closing it returns to the original reading position. TXT web addresses use the same confirmation.
- The reader looks up links only within the visible text chunks during rendering. EPUB chapter extraction periodically yields to the UI during long imports. Library format totals use one grouped SQLite query, and the icon import bundles only the Ionicons font from the vector icon set.
- The release plan caps each distributed package at 100,000,000 bytes. The package checker accepted the exact limit and rejected an empty file and a file one byte above the limit. Production EAS builds invoke it automatically.
- The local Android release build produced a **48,917,421-byte universal APK** and a **64,498,036-byte AAB**, both within the limit. Enabling native-library compression reduced the APK from 110.54 MB and retained all four Android architectures. The iOS Metro export passed. Signed IPA size remains unmeasured on this Windows host.
- TypeScript, Expo lint, both mobile exports and eight reader regression tests passed. A SQLite integration exercise with simulated native storage verified simultaneous reads during an older book's link-cache rebuild. A 600-chapter EPUB fixture verified the import, a link from the first chapter to the last and extraction of a linked off-spine footnote. Search regression coverage also reaches chapter 600.
- On an Android API 37 emulator, all four category labels and counts passed a screenshot contrast check in light portrait and dark landscape. The release app imported the 600-chapter EPUB from the system picker, showed the external address before cancellation, opened and returned from the footnote, and jumped to chapter 600 after confirmation. Searching History by author returned the book and its saved chapter. An unmatched query showed the empty state and closing search restored the row.
- Device testing exposed a grid row with one book stretching to full width. Cards now retain the selected column width on incomplete rows. During reading, the footer updates when its displayed percentages change. Bookmarks, navigation and saved progress retain the exact text offset.
- On the final APK the single-card row occupied 329 of 720 screen pixels. Six scrolling gestures in chapter 600 produced 245 frames, with a 10 ms median and a 20 ms 95th percentile. Android classified 31 frames (12.65%) as janky. The emulator restored the saved chapter and accepted a bookmark after scrolling. Frame pacing on a lower-end physical phone remains open.

## Library, reading history and scan results (2026-11-22)

- Library and History share a list row with the cover on the right. Library shows title, author and date added on the left. History shows title, author, saved chapter and the local date and time of the last read.
- History opens with the most recently read book first. Its sort and reading-status filters are independent of Library settings. The SQLite query joins saved progress to the chapter index and keeps entries whose chapter title is unavailable.
- Android scan results scroll independently above a fixed selection count and **Add to library** button. A spinner indicates an active scan or import. During import, the status identifies the current file and its position in the batch.
- Verification passed for lint, TypeScript and Android and iOS bundle exports. The SQLite check covered last-read ordering, saved progress at 0%, missing chapters and deleted records. A simulated 512-file scan exercised deselection, a 511-file import, duplicate taps, activity indicators and the final report. Physical-device layout verification remains open.

## Large-book reading and import recovery (2026-11-22)

- Opening a book loads its chapter index and saved position, then reads the selected chapter. The scrolled reader mounts up to seven text chunks and uses native line measurements for resume, bookmarks and search jumps. Reaching a chapter's end offers a next-chapter action.
- Progress writes follow user navigation and scrolling. Pending movement is flushed on background and exit. Search scans on demand, publishes partial results, skips missing chapter files and cancels superseded queries.
- A single SQLite transaction publishes the document and chapter index after the chapter files have been written. Startup recovery removes abandoned import directories. Re-import can restore the index of a document interrupted under the older importer.
- A matching EPUB can restore missing cover dimensions or artwork on the existing library entry. Repair extracts the package metadata and cover without inflating chapter text.
- Verification includes the reader regression suite (`node --test scripts/reader-regressions.test.mjs` with Node 24), a SQLite failure-and-retry exercise with simulated native adapters, TypeScript, lint and Android/iOS bundle exports. Native gesture behavior, launch latency and memory on low-end phones remain to be measured. A single-chapter TXT still loads that chapter's entire source text.

## Recent Updates (2026-11-21)

### 1. Library Order Modal Visibility & Repetition Fix
- **Issue:** The initial modal asking "How should your library be ordered?" rendered with an unreadable, barely visible transparent background and repetitively popped up.
- **Root Cause:** React Native's `StyleSheet.create` cannot parse CSS variable strings such as `rgb(var(--surface))`, causing the background to evaluate to transparent on native Android/iOS. Additionally, dismissing or re-navigating to the library re-triggered the prompt.
- **Fix:**
  - Styled `modalOverlay` with a darkened backdrop (`rgba(0,0,0,0.72)`) and `modalBox` with a solid theme-aware card container (`#1d1d22` in dark mode, `#ffffff` in light mode), crisp borders, and elevation shadow.
  - Added an **"Always use this choice"** checkbox toggle to permanently persist `libraryOrderMode` to settings.
  - Added an explanatory note stating: *"Note: You can change this choice anytime in Settings → Library."*
  - Added `orderPromptDismissed` session state so that dismissing or answering the prompt once prevents it from re-appearing during normal tab navigation.

### 2. Library Grid Layout & Book Cover Fitting (`landing_screen.jpg` Parity)
- **Issue:** Book covers stretched vertically into screen-height columns instead of properly fitting into card containers.
- **Root Cause:** `BookCover` was defining `height = '100%'` as a default prop, which in Yoga flex containers without a bounded height expanded downward to fill the entire screen, breaking the 2:3 aspect ratio.
- **Fix:**
  - Switched default layout to 2 columns (`cols2`, `deviceGridSize = 2`) matching `landing_screen.jpg`.
  - Wrapped each book card in `cardWrapper` with rounded corners (`borderRadius: 10`), dark container background (`#212125`), and hidden overflow.
  - Positioned the cover within `cardCoverFrame` constrained by `aspectRatio: 2 / 3` and `width: '100%'`, using `expo-image` with `contentFit="cover"`.
  - Added `cardDetails` container below the cover displaying the book's title (bold, 1 line with truncation) and author (muted, 1 line with truncation).
  - Cleaned up grid gap (`gap: 12`) and padding for balanced spacing.

### 3. Book Cover Reading Landing Page (Image 3 Parity)
- **Feature:** When opening a book that has cover artwork, the first chapter (chapter 0) now renders the book cover as a prominent hero landing page.
- **Implementation (`ReaderScreen.tsx`):**
  - Integrated `Image` from `expo-image` at the top of the reading scroll when `chIdx === 0 && doc?.cover_uri`.
  - Container sized with `height: Math.min(winHeight * 0.70, 560)` and `contentFit="contain"`, allowing the cover artwork to display with its natural aspect ratio on a dark reader background, matching the reference `Lord of the Mysteries` layout.
  - Scrolling down seamlessly continues into the book's chapter text.

### 4. Database Insert Fix: Column & Value Count Mismatch (`22 values for 23 columns`)
- **Issue:** 20 books failed import with `Error code 1: 22 values for 23 columns`.
- **Root Cause:** In `src/db/repositories/documents.ts` (`create` method), the SQL statement listed 23 columns (`id, format, title, author, local_uri, text_dir, cover_uri, cover_width, cover_height, content_hash, size_bytes, encoding, normalization_version, chapter_count, char_count, storage_path, last_opened_at, created_at, updated_at, deleted_at, dirty, server_updated_at, sync_error`), but the `VALUES` clause only provided 18 `?` placeholders followed by 4 literals (`NULL, 1, NULL, NULL`), giving 22 values total. The 19th parameter (`now` for `updated_at`) had no corresponding `?` placeholder.
- **Fix:** Corrected the `VALUES` clause to have 19 `?` placeholders plus the 4 sync/deletion literals (`19 + 4 = 23 values`), matching all 23 columns.

### 5. Large EPUB OutOfMemoryError Resolution (`Lord of the Mysteries`)
- **Issue:** Importing large EPUB files (such as webnovels ~138 MB) crashed on Android with:
  `Call to function 'ExponentFileSystem.readAsStringAsync' has been rejected. → Caused by: java.lang.OutOfMemoryError: Failed to allocate a 185155328 byte allocation with 81184832 free bytes and 77MB until OOM, target footprint 268435456, growth limit 268435456`.
- **Root Cause:** `importEpub.ts` used `FileSystem.readAsStringAsync` with `EncodingType.Base64` to load the archive. Converting a 138 MB binary file to Base64 in Java heap required a single contiguous 185 MB Java string allocation, which exceeded the Android JVM's 256 MB per-app heap limit (`growth limit 268435456`).
- **Fix:**
  - Implemented `readArchiveBytes(uri)` in `src/formats/epub/importEpub.ts` using chunked streaming through `FileHandle.readBytes(CHUNK)` (2 MB chunks) via `expo-file-system`. This streams data through bounded buffers directly into a Hermes native `Uint8Array` (in C++ memory outside Java VM heap constraints).
  - Configured `fflate.unzipSync` with a selective entry filter that skips heavy embedded fonts (`.ttf`, `.otf`, `.woff`, `.woff2`) and multimedia files (`.mp3`, `.mp4`) that are not rendered in Sirum's text reading engine, drastically reducing memory usage during decompression.
  - Added native `FileSystem.copyAsync` as Strategy 3 in `importer.ts` `stageFile` before any Base64 fallback, avoiding memory-ballooning when copying large picked files into the app sandbox.

---

## Previous Updates (2026-11-19)

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
- Navigation transitions live in `src/app/_layout.tsx`:
  - **All stacked screens** (`/`, `/history`, `/import`, `/settings`, `settings-*`): `animation: 'slide_from_right'`. A destination entered from the library, history or the menu slides in from the right, and going back plays the reverse (the previous page is revealed from the left). The bottom-nav and side-drawer use `router.navigate`, so menu jumps that move forward slide in from the right while returning pops back in reverse.
  - **Reader view** (`reader/[id]`): `animation: 'slide_from_bottom'` (260ms) for an immersive book-opening transition.
- The shared `Screen` wrapper (`chrome/app-bar.tsx`) plays a slight fade-in (`FadeIn`, 220ms) on mount, so every screen's native slide is softened by a light cross-fade. Reanimated skips it automatically when the system Reduce Motion setting is on.

### 5. Reader Screen Parity (plan 5.6.1, prototype `sirum-reader-prototype.html`)
- **Per-chapter reading model:** the reader now shows one chapter at a time (prototype `S.ch`) instead of all chapters in one ScrollView. Progress is still stored as global UTF-16 offsets; chapter jumps map through `positionFromOffset`/`positionFromChapterOffset`.
- **Top bar:** back, book title, in-book search, "Aa" display popup, and an overflow menu with **Add bookmark**, **Contents**, and **Settings**.
- **Bottom bar:** current chapter title, percent, and a scrubber (slider seeks within the chapter). The percent label follows `reader.percentageMode` (book % or "Ch. N of M · x%").
- **Contents panel** (`ContentsPanel.tsx`): right-side panel with three tabs — **Contents** (chapter list, current highlighted, tap to jump), **Annotations** (existing highlights/notes with delete), **Bookmarks** (chapter + % of chapter, tap to jump, delete).
- **Display popup** (`DisplayPopup.tsx`): Flow (Auto/Paged/Scrolled — stored in `reader.style.flow`; only scrolled rendering is implemented so far), brightness slider (`expo-brightness` app brightness, restored on exit, `device.readerBrightness`), theme swatches + custom bg/text colors, text size %, align (left/justify), margin % — plus the required All-books/This-book scope switch.
- **In-book search** (`SearchOverlay.tsx`): full-screen search; empty query shows recent searches (`device.searchHistory`, last 10, clearable); live results show chapter title + snippet with the match highlighted (cap 200); tapping jumps to chapter + offset.
- **Bookmarks:** added from the overflow menu at the current position (`char_offset`, `chapter_index`, `chapter_char_offset`, snippet); listed and jumpable in the Contents panel.
- New files: `src/features/reader/{ContentsPanel,DisplayPopup,SearchOverlay,types}.tsx/ts`; new repo `src/db/repositories/highlights.ts`.

### 6. Cover Normalization & Fit (plan 5.2.1)
- Covers are normalized once at import: type detected by **magic bytes** (JPEG/PNG/GIF/WebP; SVG and unknowns fall back to the generated cover), decoded via `expo-image-manipulator` with `maxWidth/maxHeight` 1200, re-encoded as JPEG (PNG kept when the source has alpha), and intrinsic dimensions stored in new local-only columns `documents.cover_width`/`cover_height` (migration `003_covers_and_import_log`).
- `BookCover` now uses `expo-image` with `contentFit`: covers within ~8% of the 2:3 frame ratio fill the frame; wider/taller art is shown whole (`contain`) over a blurred, dimmed copy of itself. `device.coverFit` (`'full'` default, `'crop'`) forces crop-fill. Added to Settings → Library → Cover fit.

### 7. Import Reliability & Diagnostics (plan 5.1.1, 4.8)
- New local-only `import_log` table (migration 003) — every import outcome (imported/duplicate/skipped/failed + reason) is recorded, pruned to the latest ~200 rows (`src/db/repositories/importLog.ts`).
- `ImportScreen` now shows an **ImportReport** per run: counts (found/imported/duplicates/skipped/failed) plus a per-file reason list, **Retry failed**, **Copy report** (share sheet), and an **Open** action on duplicates ("Already in your library").
- Folder scan hardened: visited-set recursion (depth ≤ 12), case-insensitive extension match on the decoded file name, unreadable folders surfaced as scan errors instead of silently skipped.
- `importDocument` returns the existing `documentId` on duplicates.

### 8. Settings schema additions (plan 5.8)
- New device-local keys: `device.coverFit`, `device.searchHistory`, `device.readerBrightness`.
- `reader.style` gained `flow` (`auto`/`paged`/`scrolled`) and `align` (`left`/`justify`); `size` and `mar` are now **percentages** (size 60–200%, mar 0–10% of width). `normalizeStylePatch()` converts legacy pt/px values on read.
- Settings → Reader gained a Brightness slider; Settings → Library gained Cover fit.

### 9. Dependencies added
- `expo-image-manipulator`, `expo-brightness` (SDK 58-compatible, via `npx expo install`).

### 10. Fixes (2026-11-19, second pass)
- **EPUB/picker import "isn't readable" failure:** `stageFile` now leads with the new `expo-file-system` `File` API (`File.copy`, `File.digest('SHA-256')`, `FileHandle` chunked streaming in 1 MB pieces) which handles Android `content://`/DocumentPicker cache URIs natively; legacy `copyAsync`/`readAsStringAsync` remain only as last-resort fallbacks. `sha256Hex` prefers native `file.digest`.
- **Cover fit:** covers with unknown dimensions (pre-003 imports) now default to `contain` (show whole art over blurred backdrop) instead of crop-fill; only near-2:3 art or `device.coverFit='crop'` crops. Re-importing a book normalizes its cover and stores dimensions.
- `ImageBackground` deprecation warning is **not from app code** — no `src/` file uses it; it comes from a transitive dependency rendering RN's deprecated component.

### 11. Adaptive text contrast (2026-11-21)
- New `src/lib/color.ts`: WCAG relative luminance + `contrastText(bg)` → near-black `#0b0b0d` on light backgrounds, white on dark (threshold 0.45).
- Applied to every accent-filled element: `PrimaryButton`, selected `Chip`s, bottom-nav active pill (icon + label), side-drawer active row, cover `PlayBadge`, empty-state "Import Books", order-modal "Recent first", import-report "Open" badge, reader percentage prompt "Whole book".
- Reader: changing the background swatch in the Aa popup or Settings → Reader now auto-pairs `tx` to a readable contrast; the Text color picker still overrides it afterwards. Theme preset swatches already ship bg+tx pairs.

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
| `/reader/[id]` | Reader | Reader + top bar, bottom scrubber, contents panel, Aa popup, in-book search |

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
- `reader/ReaderScreen.tsx` — per-chapter reader: progress footer + scrubber, overflow menu (bookmark/contents/settings), position restore, debounced progress writes, keep-awake, ask-once percentage prompt.
- `reader/ContentsPanel.tsx` — right-side panel: Contents / Annotations / Bookmarks tabs.
- `reader/DisplayPopup.tsx` — Aa popup: flow, brightness, theme, size %, align, margin %, scope switch.
- `reader/SearchOverlay.tsx` — in-book search with history and snippet results; uses `searchBook` for cancellable, incremental whole-book scans.
- `reader/ChunkedChapter.tsx` — windowed rendering: mounts ≤7 text chunks around the visible passage, maps scroll position to character offsets via native line layouts, restores position without a jump.
- `reader/resume.ts` — `resumePosition()`: resolves saved `chapter_index`/`char_offset` (incl. shared chapter boundaries) to a chapter + intra-chapter offset.
- `reader/ReadingStyleEditor.tsx` — shared style editor (settings page) + live preview; percentage size/margin, flow, align.
- `lib/color.ts` — WCAG luminance + `contrastText()` for adaptive black/white foregrounds on accent fills and reader backgrounds.
- `scripts/reader-regressions.test.mjs` — Node test suite (`node --test`) covering resume-position edge cases, chunk offset mapping and incremental search.

### Theming (`src/theme/`)

- `palette.ts` — dark/light/sepia palettes + green/purple/blue accents as RGB triples.
- `ThemeProvider.tsx` — resolves `device.theme`/`accent`/`appFont`, injects CSS vars via NativeWind `vars()`.

### Data layer changes

- `lib/settingsKeys.ts` — all prototype keys added (`device.*`, `reader.style`, `reader.book.<id>` helpers, types, defaults).
- `db/repositories/settings.ts` — `listAll`, `getRaw`, `setRaw` (device-local keys write `dirty = 0`), `remove`.
- `db/repositories/documents.ts` — `list()` now JOINs `reading_progress` (percent, last_read_at), supports search, format/status filters, `recent` (recency = max of last_opened_at/last_read_at/created_at) and `fixed` sort modes.
- `db/repositories/chapters.ts` — fixed table name (`document_chapters`).
- `db/repositories/highlights.ts` — list/soft-delete for the Annotations tab.
- `db/repositories/importLog.ts` — local-only import diagnostics (migration 003).
- `db/migrations/003_covers_and_import_log.ts` — `cover_width`/`cover_height` + `import_log` table. Supabase counterpart created at `supabase/migrations/20261119000001_covers_and_import_log.sql` (columns/table exist server-side but stay unused — sync pushes explicit column lists; convention documented in the dev plan §4.8).
- `formats/txt/importTxt.ts` — TXT → single normalized chapter.
- `formats/epub/importEpub.ts` — EPUB 2/3 archive parsing, metadata, cover image, TOC, DRM detection, and normalized text extraction.

### Config & Dependencies

- Added `fflate`, `fast-xml-parser`, `htmlparser2`, `expo-image-manipulator`, `expo-brightness`.
- NativeWind: `global.css`, `tailwind.config.js`, `babel.config.js`, `metro.config.js`, `nativewind-env.d.ts`.
- ESLint flat config installed (`eslint.config.js`); `npx tsc --noEmit` and `npx eslint` pass cleanly with 0 errors.

---

## Prototype Feature Checklist

| Feature | Status | Notes |
|---|---|---|
| Bottom tab bar nav | ✅ | Library / History / Import / Settings |
| Side drawer nav | ✅ | Same destinations + format items |
| Library grid 2/3/4 cols | ✅ | View + grid size in filter sheet; refined 2:3 card styling |
| List view | ✅ | Title, author and date added on the left, cover on the right, with format and reading progress |
| Caption vs overlay card styles | ✅ | 2 cols = detailed caption, 3–4 = compact overlay title |
| Show/hide badges & details | ✅ | `device.showBadges`, `device.showDetails` |
| Search title/author | ✅ | Toggle in app bar with instant clear |
| Format tabs + counts | ✅ | Bottom mode; drawer items in side mode |
| Filter sheet (view/sort/grid/format/status) | ✅ | Sort disabled in `recent` order mode |
| Library order recent vs fixed | ✅ | Recency SQL per plan; ask-once prompt |
| History screen | ✅ | Saved chapter and last-read timestamp, newest first by default, with History-only sorting and filtering |
| Import: manual picker | ✅ | `.txt` and `.epub` import fully; `.pdf` reported unsupported |
| Import: device scan (Android) | ✅ | SAF folder pick, recursive scan, resilient staging |
| EPUB import & reading | ✅ | Pure-JS extraction (`fflate`, `fast-xml-parser`, `htmlparser2`) |
| Settings hub + 6 sub-pages | ✅ | All prototype categories |
| Appearance theme/accent/app font | ✅ | Runtime CSS vars, live switch |
| Reader screen | ✅ | Per-chapter reading, windowed chunk rendering, top bar, bottom scrubber, overflow menu |
| Reader contents panel | ✅ | Contents / Annotations / Bookmarks tabs, tap-to-jump |
| Reader display popup (Aa) | ✅ | Flow, brightness, theme, size %, align, margin %, scope switch |
| In-book search | ✅ | History (last 10), live snippet results, jump-to-match |
| Bookmarks | ✅ | Add from menu, list/jump/delete in panel |
| Cover normalization & fit | ✅ | Magic-byte type detection, resize ≤1200px, dims stored, contain-over-blur |
| Import report & diagnostics | ✅ | Per-file reasons, counts, retry failed, copy report, open duplicate |
| Reader "Aa" display sheet | ✅ | Scope all/book, presets, sliders, swatches, reset (settings page editor) |
| Per-book style overrides | ✅ | `reader.book.<id>` synced keys |
| Progress display book/chapter | ✅ | Footer label + ask-once prompt |
| Progress save/restore | ✅ | Debounced writes, chapter-aware resume, flush on background/exit, no write-on-open |
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
| M4b Reader screen parity | Contents panel, display popup, in-book search, scrubber (5.6.1) | 🟢 Mostly done | Scrolled flow and viewport page turns implemented. Line-aligned pagination and physical-device profiling remain open. |
| M5 PDF + annotations | pdf.js extraction; bookmarks/highlights/notes | 🟡 Partial | Highlight creation, styling, note editing and annotation list implemented; PDF not started |
| M6 Backend | Schema + RLS + triggers verified | 🟡 SQL written, unverified |
| M7 Google sign-in | EAS dev build, sign in/out | ⬜ Not started |
| M8 Sync v1 | Push/pull, "Not on this device", two-device test | ⬜ Not started |
| M9 Hardening | Offline/failure/security/perf tests | ⬜ Not started |
| M10–M11 Beta/Release | — | ⬜ Not started |

---

## Known Gaps & Next Steps

### Immediate (Phase 3 remaining)

1. **Page boundaries.** Profile viewport turns in heavily illustrated chapters. Exact line-aligned pagination and physical-device frame measurements remain open.
2. **PDF importer** — `react-native-webview` + pdf.js spike per plan 5.4. Keep the WebView offline, local-asset only, and unable to reach the book directory.
3. **Native text-selection verification** — verify selection handles, custom popup coexistence, copy/share targets, and text hit-testing on Android and iOS.
4. **Reactive reads** — repository change notifications so library updates without focus reloads (plan 4.6).
5. **Large-book device profiling** check restore, chapter transitions, search jumps, peak memory and long flings on Android and iOS, including a 500+ page EPUB and a single-chapter TXT.
6. **Remove from library.** ✅ Confirmed removal with undo is implemented; local files remain available through the undo window (plan 5.9).
7. **Import limits.** ✅ EPUB paths, duplicate entries, compressed/expanded sizes and XML DTD/entity handling are bounded; physical-device testing with large books remains open.

### Practice and security review (2026-11-26)

Reviewed against common reader-app behavior (library management, reading controls, store privacy) and against local-data risks for an app that stores other people's books. The reader already does several of the important things: book HTML is parsed to text instead of loaded in a WebView, external links require an explicit open after the address is shown, `javascript:` and other non-web schemes are rejected in `resolveBookLink`, queries use bound parameters, progress writes do not mark a book dirty on open, and the Supabase SQL enables RLS, omits delete policies, and revokes the anon role.

**Do before sync or a store build**

| Item | Why |
|---|---|
| Session storage | `src/auth/supabase.ts` persists the Supabase session in AsyncStorage. That store is unencrypted and is included in a normal device backup. `expo-secure-store` is already installed. Move the session to the platform keystore, chunking if a token exceeds the SecureStore size limit. |
| Device backup | Book files, chapter text, notes, and `reader.db` live in the app documents directory. Android Auto Backup and iOS backup copy that directory by default, so "books stay on this device" is not yet true of a Google or iCloud backup. Exclude `books/` and the database, or say so in About and the privacy policy. |
| Archive safety | `archivePath` strips a leading slash but still accepts `..` segments. `unzipSync` inflates a whole EPUB with no uncompressed-size cap, so a small zip can exhaust memory. Reject absolute paths, `..`, NUL bytes, and duplicate names. Stop inflating past a fixed per-entry and total budget. |
| EPUB XML | `XMLParser` is created with attribute parsing only. fast-xml-parser still expands entities by default. Disable entity processing and reject documents that contain a `DOCTYPE`. |
| Column updates | `documents.update` copies object keys into SQL identifiers. Highlights already allowlist `color` and `note`. ✅ Done — `documents.update` now writes only an allowlisted set of metadata columns; unknown keys are ignored. |
| SVG illustrations | `isPublicationAsset` caches `.svg` and the reader displays those files with `expo-image`. Keep illustrations to PNG, JPEG, GIF, and WebP. Do not render publisher SVG or HTML in a WebView. |
| External links | The scheme allowlist is in place. Also drop URLs that contain credentials (`user:pass@host`) and show the host in the preview, not only the full address. |
| PDF WebView | When PDF extraction starts, load pdf.js from the app bundle only. Disable navigation, remote URLs, and file access outside the chosen PDF. |
| Auth, when it starts | Use the system browser and PKCE. Allow only the app's redirect URI. Do not log tokens, snippets, or file paths. Account deletion has to exist before store submission (plan 10.2). Ship no service-role key. |
| Missing config | The Supabase client is constructed even when `EXPO_PUBLIC_SUPABASE_URL` or the anon key is empty. Fail closed until both are set, and keep using a separate project for production. |

**Reader and library behavior worth refining**

| Item | Why | Status |
|---|---|---|
| Delete a book | Planned in 5.9 and implemented in the repository, missing in the library UI. One-tap bookmark and highlight deletion also has no undo. | ✅ Resolved (long-press delete dialog + 5s undo toast; bookmark/highlight restore) |
| Onboarding | First launch does not explain that reading is offline and that sign-in is optional. About already states the privacy split; the first-run screen should say the same thing before anyone imports a library. | ✅ Resolved (first-run onboarding modal with offline & privacy pillars) |
| Accessibility | Many controls have roles and labels. Book cards announce the title only, so author and progress are invisible to a screen reader. Confirm text at the largest system size still scrolls inside the Aa sheet, settings, and the order prompt. | 🟢 Resolved for book cards & rows (comprehensive title/author/format/progress/local labels + accessibility hints); toasts (including Undo) are now announced via `announceForAccessibility`. |
| Touch and motion | Chapter turns and deletes have no haptic confirmation. System Reduce Motion is already honored. Keep new motion on the native driver and skip it when Reduce Motion is on. | ✅ Resolved — `src/lib/haptics.ts` wired into reader turns/bookmarks/highlights and library delete/undo. |
| Link and share copy | Copy and share are user-initiated, which is the right default. Do not put passage text on the clipboard any other way. | Open |
| Production failures | `logger` prints only in development, so a release crash or a failed import leaves no record. Add a crash reporter later that drops book text, paths, notes, and tokens. | ✅ Resolved (`src/lib/logger.ts` 50-breadcrumb ring buffer + recursive `sanitize()` redacting paths/text/tokens/notes) |
| CI | Lint, `tsc`, and the reader regression script are local. Run them on every change before sync code lands (plan 9.5 and 9.8). | Open |
