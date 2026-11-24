import type { ChapterImage, ChapterParagraph } from '../formats/types';

export interface Chunk {
  image?: ChapterImage;
  chapterIndex: number;
  chunkIndex: number;    // index within the chapter
  startOffset: number;   // global char offset
  text: string;
}

/** Slice only the mounted chunk. A paragraph continued after an image or a hard cut keeps its indent. */
export function paragraphRows(chunk: Chunk, paragraphs: ChapterParagraph[]) {
  let low = 0;
  let high = paragraphs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (paragraphs[mid].offset <= chunk.startOffset) low = mid + 1;
    else high = mid;
  }
  const rows = [];
  const end = chunk.startOffset + chunk.text.length;
  let from = chunk.startOffset;
  let index = low - 1;
  while (from < end) {
    const paragraph = paragraphs[index];
    const to = Math.min(end, paragraphs[index + 1]?.offset ?? end);
    if (to > from) rows.push({
      ...chunk, startOffset: from, text: chunk.text.slice(from - chunk.startOffset, to - chunk.startOffset),
      paragraph, first: from === paragraph?.offset,
    });
    index++;
    from = to;
  }
  return rows;
}

const CHUNK_SIZE = 3000; // target ~3 KB per chunk at paragraph boundaries

/** Supply row starts for plain text when the reader applies first-line indentation. */
export function plainParagraphs(text: string): ChapterParagraph[] {
  const rows: ChapterParagraph[] = [];
  for (let at = 0; at < text.length;) {
    rows.push({ offset: at, gap: 0, blankLines: 0, indent: 0 });
    const newline = text.indexOf('\n', at);
    if (newline < 0) break;
    at = newline + 1;
  }
  return rows;
}

/**
 * Split chapter text into Chunks at \n boundaries, up to CHUNK_SIZE chars each.
 * chapterStartOffset is the chapter's global start_offset.
 */
export function chunkChapter(
  chapterIndex: number,
  chapterText: string,
  chapterStartOffset: number,
  images?: ChapterImage[],
  paragraphs?: ChapterParagraph[]
): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphsPerChunk = 40;
  if (images?.length || (paragraphs?.length ?? 0) > paragraphsPerChunk) {
    let cursor = 0;
    const appendText = (end: number) => {
      for (const chunk of chunkChapter(chapterIndex, chapterText.slice(cursor, end), chapterStartOffset + cursor)) {
        chunks.push({ ...chunk, chunkIndex: chunks.length });
      }
      cursor = end;
    };
    let paragraph = paragraphsPerChunk;
    let imageIndex = 0;
    while (paragraph < (paragraphs?.length ?? 0) || imageIndex < (images?.length ?? 0)) {
      const image = images?.[imageIndex];
      const offset = paragraphs?.[paragraph]?.offset ?? Infinity;
      if (image && image.offset <= offset) {
        appendText(image.offset);
        chunks.push({ chapterIndex, chunkIndex: chunks.length, startOffset: chapterStartOffset + cursor, text: '', image });
        imageIndex++;
      } else {
        appendText(offset);
        paragraph += paragraphsPerChunk;
      }
    }
    appendText(chapterText.length);
    return chunks;
  }
  let chunkIndex = 0;
  let pos = 0;
  const len = chapterText.length;

  while (pos < len) {
    const remaining = len - pos;

    if (remaining <= CHUNK_SIZE) {
      // Last chunk — take everything remaining
      chunks.push({
        chapterIndex,
        chunkIndex,
        startOffset: chapterStartOffset + pos,
        text: chapterText.slice(pos),
      });
      break;
    }

    // Look for the last \n within [pos, pos + CHUNK_SIZE)
    let splitAt = -1;
    for (let i = pos + CHUNK_SIZE - 1; i >= pos; i--) {
      if (chapterText[i] === '\n') {
        splitAt = i;
        break;
      }
    }

    if (splitAt === -1) {
      // No newline found — hard-cut at CHUNK_SIZE
      splitAt = pos + CHUNK_SIZE - 1;
    }

    // Include the \n in the chunk (splitAt is the newline position, include it)
    let end = splitAt + 1;
    // A native Text node must never start halfway through an emoji.
    if (/[\uD800-\uDBFF]/.test(chapterText[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(chapterText[end])) end--;
    chunks.push({
      chapterIndex,
      chunkIndex,
      startOffset: chapterStartOffset + pos,
      text: chapterText.slice(pos, end),
    });

    chunkIndex++;
    pos = end;
  }

  return chunks;
}

/** Given a global offset, binary-search a flat chunk array to find the chunk index. */
export function findChunkForOffset(chunks: Chunk[], charOffset: number): number {
  if (chunks.length === 0) return 0;

  let lo = 0;
  let hi = chunks.length - 1;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (chunks[mid].startOffset <= charOffset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}
