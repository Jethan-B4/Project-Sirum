export interface Chunk {
  chapterIndex: number;
  chunkIndex: number;    // index within the chapter
  startOffset: number;   // global char offset
  text: string;
}

const CHUNK_SIZE = 3000; // target ~3 KB per chunk at paragraph boundaries

/**
 * Split chapter text into Chunks at \n boundaries, up to CHUNK_SIZE chars each.
 * chapterStartOffset is the chapter's global start_offset.
 */
export function chunkChapter(
  chapterIndex: number,
  chapterText: string,
  chapterStartOffset: number
): Chunk[] {
  const chunks: Chunk[] = [];
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
