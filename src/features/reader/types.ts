import type { ChapterRow } from '@/db/repositories/chapters';

export type ReaderChapter = ChapterRow;

/** Result of an in-book search (plan 5.6.1). */
export interface SearchResult {
  chapterIndex: number;
  /** UTF-16 offset of the match within the chapter text. */
  chapterOffset: number;
  chapterTitle: string;
  before: string;
  match: string;
  after: string;
}
