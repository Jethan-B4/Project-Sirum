import * as FileSystem from 'expo-file-system/legacy';

import { normalizeText } from '@/text/normalize';
import type { Chapter, ImportedBook } from '../types';

/**
 * TXT importer: the whole file becomes a single chapter of normalized text.
 * Chapter percentage falls back to book percentage for single-chapter docs.
 *
 * Encoding: UTF-8 is assumed (with or without BOM — normalizeText strips U+FEFF).
 * UTF-16 and legacy code pages are not yet detected; `encoding` records what
 * was used so a future detector can re-run extraction.
 */
export async function importTxt(
  uri: string,
  opts: { title: string; contentHash: string; sizeBytes: number }
): Promise<ImportedBook> {
  const raw = await FileSystem.readAsStringAsync(uri);
  const text = normalizeText(raw);

  const chapter: Chapter = {
    index: 0,
    title: opts.title,
    startOffset: 0,
    charCount: text.length,
    text,
  };

  return {
    format: 'txt',
    title: opts.title,
    contentHash: opts.contentHash,
    sizeBytes: opts.sizeBytes,
    encoding: 'utf-8',
    normalizationVersion: 1,
    charCount: text.length,
    chapters: [chapter],
  };
}
