import type { Chapter } from '../formats/types';
import { positionFromOffset, positionFromChapterOffset } from './position';
import type { BookPosition } from './position';

const SEARCH_WINDOW = 2000; // chars to search around saved position

/**
 * Try to re-anchor a saved position when offsets may have shifted.
 * 1. Check if snippet matches at charOffset → return as-is
 * 2. Search near chapterCharOffset within the chapter → return corrected offset
 * 3. Fall back to chapter start + saved percent within chapter
 */
export function reanchor(
  saved: BookPosition,
  chapters: Chapter[],
  charCount: number
): BookPosition {
  if (chapters.length === 0) {
    return saved;
  }

  const chapterIdx = Math.min(Math.max(0, saved.chapterIndex), chapters.length - 1);
  const chapter = chapters[chapterIdx];
  const snippet = saved.snippet;

  // Step 1: Check if snippet matches at the saved global charOffset
  if (snippet) {
    const localOffset = saved.charOffset - chapter.startOffset;
    if (
      localOffset >= 0 &&
      localOffset <= chapter.charCount &&
      chapter.text.startsWith(snippet, localOffset)
    ) {
      return saved;
    }

    // Step 2: Search near chapterCharOffset within the chapter
    const searchStart = Math.max(0, saved.chapterCharOffset - SEARCH_WINDOW);
    const searchEnd = Math.min(chapter.charCount, saved.chapterCharOffset + SEARCH_WINDOW);
    const searchArea = chapter.text.slice(searchStart, searchEnd + snippet.length);
    const foundIdx = searchArea.indexOf(snippet);

    if (foundIdx !== -1) {
      const newChapterOffset = searchStart + foundIdx;
      const newGlobalOffset = chapter.startOffset + newChapterOffset;
      return positionFromOffset(newGlobalOffset, chapters, charCount);
    }
  }

  // Step 3: Fall back to chapter start + saved percent within chapter
  const fallbackChapterOffset = Math.round(saved.percent * chapter.charCount);
  return positionFromChapterOffset(chapterIdx, fallbackChapterOffset, chapters, charCount);
}
