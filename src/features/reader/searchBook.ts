import type { ReaderChapter, SearchResult } from './types';

const RESULT_CAP = 200;
const BLOCK = 32 * 1024;

export async function searchBook(
  chapters: ReaderChapter[],
  query: string,
  readChapter: (index: number) => Promise<string>,
  cancelled: () => boolean,
  publish: (results: SearchResult[]) => void,
) {
  const term = query.trim();
  let skipped = 0;
  if (!term) return skipped;
  const literal = term.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  const pattern = new RegExp(literal, 'iu');
  const found: SearchResult[] = [];
  for (const [index, chapter] of chapters.entries()) {
    if (cancelled()) return skipped;
    let text: string;
    try {
      text = await readChapter(chapter.chapter_index);
    } catch {
      skipped++;
      continue;
    }
    let cursor = 0;
    let published = found.length;
    while (cursor < text.length && !cancelled()) {
      const end = Math.min(text.length, cursor + BLOCK);
      const slice = text.slice(cursor, end + term.length - 1);
      let pos = cursor;
      while (pos < end) {
        const match = pattern.exec(slice.slice(pos - cursor));
        if (!match || pos + match.index >= end) {
          pos = end;
          break;
        }
        const offset = pos + match.index;
        const lineEnd = text.indexOf('\n', offset);
        const before =
          text
            .slice(Math.max(0, offset - 30), offset)
            .split('\n')
            .pop() ?? '';
        found.push({
          chapterIndex: index,
          chapterOffset: offset,
          chapterTitle: chapter.title ?? 'Chapter ' + (index + 1),
          before,
          match: match[0],
          after: text.slice(offset + match[0].length, offset + match[0].length + 30).split('\n')[0],
        });
        if (found.length === RESULT_CAP) {
          publish(found);
          return skipped;
        }
        pos = lineEnd < 0 ? text.length : lineEnd + 1;
      }
      cursor = pos;
      if (found.length !== published) {
        publish([...found]);
        published = found.length;
      }
      if (cursor < text.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return skipped;
}
