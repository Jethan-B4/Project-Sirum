import type { ChapterRow } from '@/db/repositories/chapters';
import type { ProgressRow } from '@/db/repositories/progress';

/** Prefer the saved chapter at a shared chapter boundary. Older rows may only have a global offset. */
export function resumePosition(
  rows: Pick<ChapterRow, 'start_offset' | 'char_count'>[],
  saved: Pick<ProgressRow, 'char_offset' | 'chapter_index'> | null,
) {
  const global = saved?.char_offset ?? 0;
  let index = saved?.chapter_index ?? 0;
  const candidate = rows[index];
  if (
    !candidate ||
    global < candidate.start_offset ||
    global > candidate.start_offset + candidate.char_count
  ) {
    index = Math.max(
      0,
      rows.findLastIndex((row) => row.start_offset <= global),
    );
  }
  const row = rows[index];
  const offset = row ? Math.max(0, Math.min(row.char_count, global - row.start_offset)) : 0;
  return { row, index, offset };
}
