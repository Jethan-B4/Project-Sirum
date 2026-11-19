// Central definition of the keys stored in the `settings` table (key/value, JSON-encoded,
// synced across devices). Keep key names, value types, and defaults here so every part of
// the app agrees on them.
//
// IMPORTANT: defaults below are used IN MEMORY ONLY. Never write a default to the database.
// Storing a default would give it a fresh `updated_at`, and under latest-wins sync it could
// overwrite a real choice the user made on another device. A key that is missing from the
// table means "the user has not chosen yet" (which is also what triggers the one-time prompts).

export const SettingKeys = {
  // Reader
  readerPercentageMode: 'reader.percentageMode',

  // Library
  libraryOrderMode: 'library.orderMode',
  librarySort: 'library.sort',
  librarySortDirection: 'library.sortDirection',
  libraryFilters: 'library.filters',
} as const;

export type SettingKey = (typeof SettingKeys)[keyof typeof SettingKeys];

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

export interface SettingValues {
  [SettingKeys.readerPercentageMode]: PercentageMode;
  [SettingKeys.libraryOrderMode]: LibraryOrderMode;
  [SettingKeys.librarySort]: LibrarySort;
  [SettingKeys.librarySortDirection]: SortDirection;
  [SettingKeys.libraryFilters]: LibraryFilters;
}

// --- In-memory defaults (never persisted) -----------------------------------

export const SettingDefaults: SettingValues = {
  [SettingKeys.readerPercentageMode]: 'book',
  [SettingKeys.libraryOrderMode]: 'recent',
  [SettingKeys.librarySort]: 'added',
  [SettingKeys.librarySortDirection]: 'desc',
  [SettingKeys.libraryFilters]: {},
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
