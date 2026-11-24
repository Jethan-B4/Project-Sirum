import type { Chapter } from '../formats/types';

export interface BookPosition {
  charOffset: number;        // global UTF-16 offset
  chapterIndex: number;
  chapterCharOffset: number; // offset within chapter
  percent: number;           // book-wide 0–1
  snippet: string;           // ~100 chars at position
}

const DEFAULT_SNIPPET_LENGTH = 100;

/** Keep 100% for a position at the end of the selected range. */
export function displayPercent(fraction: number) {
  return fraction >= 1 ? 100 : Math.min(99, Math.round(fraction * 100));
}

export function bookSliderDestination(value: number, chapters: readonly { start_offset: number; char_count: number }[], count: number) {
  if (!chapters.length || value <= 0) return { index: 0, fraction: 0 };
  if (value >= 100) return { index: chapters.length - 1, fraction: 1 };
  const offset = Math.round(count * value / 100);
  const index = Math.max(0, chapters.findLastIndex(ch => ch.start_offset <= offset));
  const chapter = chapters[index];
  return { index, fraction: chapterPercent(offset - chapter.start_offset, chapter.char_count) };
}

/** Book-wide percentage */
export function bookPercent(charOffset: number, charCount: number): number {
  if (charCount <= 0) return 0;
  return Math.min(1, Math.max(0, charOffset / charCount));
}

/** Chapter percentage */
export function chapterPercent(chapterCharOffset: number, chapterCharCount: number): number {
  if (chapterCharCount <= 0) return 0;
  return Math.min(1, Math.max(0, chapterCharOffset / chapterCharCount));
}

/**
 * Build BookPosition from a global char offset.
 * Binary-searches chapters by startOffset to find the containing chapter.
 */
export function positionFromOffset(
  charOffset: number,
  chapters: Chapter[],
  charCount: number,
  snippetLength: number = DEFAULT_SNIPPET_LENGTH
): BookPosition {
  if (chapters.length === 0) {
    return {
      charOffset: 0,
      chapterIndex: 0,
      chapterCharOffset: 0,
      percent: 0,
      snippet: '',
    };
  }

  const clampedOffset = Math.min(Math.max(0, charOffset), charCount);

  // Binary search: find the last chapter whose startOffset <= clampedOffset
  let lo = 0;
  let hi = chapters.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (chapters[mid].startOffset <= clampedOffset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const chapter = chapters[lo];
  const chapterCharOffset = clampedOffset - chapter.startOffset;
  const snippet = chapter.text.slice(chapterCharOffset, chapterCharOffset + snippetLength);

  return {
    charOffset: clampedOffset,
    chapterIndex: chapter.index,
    chapterCharOffset,
    percent: bookPercent(clampedOffset, charCount),
    snippet,
  };
}

/**
 * Build BookPosition from (chapterIndex, chapterCharOffset).
 */
export function positionFromChapterOffset(
  chapterIndex: number,
  chapterCharOffset: number,
  chapters: Chapter[],
  charCount: number
): BookPosition {
  if (chapters.length === 0) {
    return {
      charOffset: 0,
      chapterIndex: 0,
      chapterCharOffset: 0,
      percent: 0,
      snippet: '',
    };
  }

  const idx = Math.min(Math.max(0, chapterIndex), chapters.length - 1);
  const chapter = chapters[idx];
  const clampedChapterOffset = Math.min(Math.max(0, chapterCharOffset), chapter.charCount);
  const charOffset = chapter.startOffset + clampedChapterOffset;
  const snippet = chapter.text.slice(clampedChapterOffset, clampedChapterOffset + DEFAULT_SNIPPET_LENGTH);

  return {
    charOffset,
    chapterIndex: chapter.index,
    chapterCharOffset: clampedChapterOffset,
    percent: bookPercent(charOffset, charCount),
    snippet,
  };
}
