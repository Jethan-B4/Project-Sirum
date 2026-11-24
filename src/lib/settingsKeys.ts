// Central definition of the keys stored in the `settings` table (key/value, JSON-encoded,
// synced across devices unless noted). Keep key names, value types, and defaults here so
// every part of the app agrees on them.
//
// IMPORTANT: defaults below are used IN MEMORY ONLY. Never write a default to the database.
// Storing a default would give it a fresh `updated_at`, and under latest-wins sync it could
// overwrite a real choice the user made on another device. A key that is missing from the
// table means "the user has not chosen yet" (which is also what triggers the one-time prompts).

export const SettingKeys = {
  // Reader (synced)
  readerPercentageMode: 'reader.percentageMode',
  readerStyle: 'reader.style',
  readerNextButton: 'reader.nextChapterButton',
  readerEdgeTaps: 'reader.edgeTaps',
  readerTransition: 'reader.transition',
  readerTransitionSpeed: 'reader.transitionSpeed',

  // Library (synced)
  libraryOrderMode: 'library.orderMode',
  librarySort: 'library.sort',
  librarySortDirection: 'library.sortDirection',
  libraryFilters: 'library.filters',

  // Device-local (prefixed `device.` — stored with dirty = 0, never pushed)
  deviceNavMode: 'device.navMode',
  deviceLibraryLayout: 'device.libraryLayout',
  deviceViewMode: 'device.viewMode',
  deviceGridSize: 'device.gridSize',
  deviceImportMethod: 'device.importMethod',
  deviceTheme: 'device.theme',
  deviceAccent: 'device.accent',
  deviceAppFont: 'device.appFont',
  deviceShowBadges: 'device.showBadges',
  deviceShowDetails: 'device.showDetails',
  deviceCoverFit: 'device.coverFit',
  deviceSearchHistory: 'device.searchHistory',
  deviceReaderBrightness: 'device.readerBrightness',
} as const;

export type SettingKey = (typeof SettingKeys)[keyof typeof SettingKeys];

/** Per-book reading style override: `reader.book.<documentId>` (synced, JSON partial). */
export function readerBookKey(documentId: string): string {
  return `reader.book.${documentId}`;
}

/** True for keys that must never be pushed to the server (device-local). */
export function isDeviceLocalKey(key: string): boolean {
  return key.startsWith('device.');
}

// --- Value types -------------------------------------------------------------

/** Reader progress label: percentage of the whole book, or of the current chapter only. */
export type PercentageMode = 'book' | 'chapter';

/**
 * Library ordering:
 *  - 'recent': opening a book moves it to the top (ordered by recency)
 *  - 'fixed' : order comes only from the chosen sort and filters; opening never moves a book
 */
export type LibraryOrderMode = 'recent' | 'fixed';

export type LibrarySort = 'title' | 'author' | 'added' | 'lastRead' | 'progress';
export type SortDirection = 'asc' | 'desc';

export type DocumentFormat = 'epub' | 'txt' | 'pdf';
export type ReadingStatus = 'unread' | 'inProgress' | 'finished';

export interface LibraryFilters {
  formats?: DocumentFormat[];
  status?: ReadingStatus[];
}

/** Navigation chrome: bottom tab bar, or a hidden side drawer. */
export type NavMode = 'bottom' | 'side';
/** Starting library layout: 2-column captions or 3-column overlays. */
export type LibraryLayout = 'cols2' | 'cols3';
export type ViewMode = 'grid' | 'list';
export type GridSize = 2 | 3 | 4;
export type ImportMethod = 'scan' | 'manual';
export type AppThemeChoice = 'system' | 'dark' | 'light' | 'sepia';
export type AccentChoice = 'green' | 'purple' | 'blue';
export type AppFontChoice = 'system' | 'serif' | 'humanist' | 'mono';
export type CoverFit = 'full' | 'crop';

/** Reading flow: continuous scroll (v1), paged, or auto (paged on wide screens). */
export type ReadingFlow = 'auto' | 'paged' | 'scrolled';
export type TextAlign = 'left' | 'justify';

/**
 * Reading display style. Style only — never changes character offsets.
 * `size` is a percentage of the base font size (60–200, default 100) and
 * `mar` is horizontal margin as a percentage of the reading width (0–10).
 */
export interface ReadingStyle {
  fam: 'serif' | 'sans' | 'mono';
  wt: 400 | 500 | 700;
  size: number; // percent of base size
  lh: number; // line-height multiplier
  mar: number; // horizontal margin, % of reading width
  bg: string; // hex color
  tx: string; // hex color
  flow: ReadingFlow;
  align: TextAlign;
  indentParagraphs: boolean;
  indentLength: number; // em spaces
}

export interface SettingValues {
  [SettingKeys.readerNextButton]: boolean;
  [SettingKeys.readerEdgeTaps]: boolean;
  [SettingKeys.readerTransition]: 'fade' | 'slide' | 'none';
  [SettingKeys.readerTransitionSpeed]: 'fast' | 'normal' | 'slow';
  [SettingKeys.readerPercentageMode]: PercentageMode;
  [SettingKeys.readerStyle]: ReadingStyle;
  [SettingKeys.libraryOrderMode]: LibraryOrderMode;
  [SettingKeys.librarySort]: LibrarySort;
  [SettingKeys.librarySortDirection]: SortDirection;
  [SettingKeys.libraryFilters]: LibraryFilters;
  [SettingKeys.deviceNavMode]: NavMode;
  [SettingKeys.deviceLibraryLayout]: LibraryLayout;
  [SettingKeys.deviceViewMode]: ViewMode;
  [SettingKeys.deviceGridSize]: GridSize;
  [SettingKeys.deviceImportMethod]: ImportMethod;
  [SettingKeys.deviceTheme]: AppThemeChoice;
  [SettingKeys.deviceAccent]: AccentChoice;
  [SettingKeys.deviceAppFont]: AppFontChoice;
  [SettingKeys.deviceShowBadges]: boolean;
  [SettingKeys.deviceShowDetails]: boolean;
  [SettingKeys.deviceCoverFit]: CoverFit;
  [SettingKeys.deviceSearchHistory]: string[];
  [SettingKeys.deviceReaderBrightness]: number;
}

// --- In-memory defaults (never persisted) -----------------------------------

export const DEFAULT_READING_STYLE: ReadingStyle = {
  fam: 'serif',
  wt: 400,
  size: 100,
  lh: 1.6,
  mar: 2,
  bg: '#121212',
  tx: '#e6e6e6',
  flow: 'scrolled',
  align: 'justify',
  indentParagraphs: false,
  indentLength: 2,
};

export const SettingDefaults: SettingValues = {
  [SettingKeys.readerNextButton]: true,
  [SettingKeys.readerEdgeTaps]: true,
  [SettingKeys.readerTransition]: 'fade',
  [SettingKeys.readerTransitionSpeed]: 'normal',
  [SettingKeys.readerPercentageMode]: 'book',
  [SettingKeys.readerStyle]: DEFAULT_READING_STYLE,
  [SettingKeys.libraryOrderMode]: 'recent',
  [SettingKeys.librarySort]: 'added',
  [SettingKeys.librarySortDirection]: 'desc',
  [SettingKeys.libraryFilters]: {},
  [SettingKeys.deviceNavMode]: 'bottom',
  [SettingKeys.deviceLibraryLayout]: 'cols2',
  [SettingKeys.deviceViewMode]: 'grid',
  [SettingKeys.deviceGridSize]: 2,
  [SettingKeys.deviceImportMethod]: 'scan',
  [SettingKeys.deviceTheme]: 'system',
  [SettingKeys.deviceAccent]: 'green',
  [SettingKeys.deviceAppFont]: 'system',
  [SettingKeys.deviceShowBadges]: true,
  [SettingKeys.deviceShowDetails]: true,
  [SettingKeys.deviceCoverFit]: 'full',
  [SettingKeys.deviceSearchHistory]: [],
  [SettingKeys.deviceReaderBrightness]: 100,
};

// --- Related constants -------------------------------------------------------

/** A book counts as "finished" when its book-wide percent is at or above this value (0 to 1). */
export const FINISHED_THRESHOLD = 0.99;

// --- Typed helpers for (de)serializing values to the JSON text column ---------

export function serializeSetting<K extends keyof SettingValues>(
  _key: K,
  value: SettingValues[K]
): string {
  return JSON.stringify(value);
}

/** Returns the parsed value, or `undefined` if the stored text is missing or invalid. */
export function parseSetting<K extends keyof SettingValues>(
  _key: K,
  raw: string | null | undefined
): SettingValues[K] | undefined {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as SettingValues[K];
  } catch {
    return undefined;
  }
}

/** Value to use at runtime: the stored choice if present, otherwise the in-memory default. */
export function resolveSetting<K extends keyof SettingValues>(
  key: K,
  raw: string | null | undefined
): SettingValues[K] {
  return parseSetting(key, raw) ?? SettingDefaults[key];
}

/** Parse a per-book reading style override (`reader.book.<id>`); `undefined` if absent/invalid. */
export function parseBookStyle(raw: string | null | undefined): Partial<ReadingStyle> | undefined {
  if (raw == null) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<ReadingStyle>;
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a stored style patch to current units. Styles saved before the
 * percentage change stored `size` in pt (14–28) and `mar` in px (0–48);
 * current values are percentages (size 60–200, mar 0–10).
 */
export function normalizeStylePatch(
  patch: Partial<ReadingStyle> | undefined
): Partial<ReadingStyle> | undefined {
  if (!patch) return patch;
  const out = { ...patch };
  if (out.indentLength !== undefined) {
    out.indentLength = Number.isFinite(out.indentLength) ? Math.max(1, Math.min(4, Math.round(out.indentLength))) : 2;
  }
  if (typeof out.size === 'number' && out.size > 0 && out.size <= 30) {
    out.size = Math.round((out.size / 18) * 100);
  }
  if (typeof out.mar === 'number' && out.mar > 10) {
    out.mar = Math.min(10, Math.round(out.mar / 4));
  }
  return out;
}
