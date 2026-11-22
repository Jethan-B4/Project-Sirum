import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkChapter, findChunkForOffset } from '../src/text/chunk.ts';
import { resumePosition } from '../src/features/reader/resume.ts';
import { searchBook } from '../src/features/reader/searchBook.ts';

const chapters = Array.from({ length: 600 }, (_, i) => ({
  chapter_index: i,
  title: 'Chapter ' + (i + 1),
  start_offset: i * 2000,
  char_count: 2000,
}));

test('resume opens the saved chapter even at a shared boundary', () => {
  for (const index of [0, 499, 599]) {
    for (const offset of [0, 83, 2000]) {
      const saved = { chapter_index: index, char_offset: index * 2000 + offset };
      const position = resumePosition(chapters, saved);
      assert.equal(position.index, index);
      assert.equal(position.offset, offset);
    }
  }
  assert.equal(resumePosition(chapters, null).offset, 0);
  assert.equal(resumePosition(chapters, { chapter_index: 0, char_offset: 999000 }).index, 499);
});

test('a long single chapter preserves UTF-16 offsets and complete emoji across chunks', () => {
  const text = ('a'.repeat(2999) + '\u{1f4da}').repeat(600);
  const chunks = chunkChapter(0, text, 0);
  assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 3000);
    assert.ok(chunk.text.isWellFormed());
    assert.equal(findChunkForOffset(chunks, chunk.startOffset), chunk.chunkIndex);
    assert.equal(
      findChunkForOffset(chunks, chunk.startOffset + chunk.text.length - 1),
      chunk.chunkIndex,
    );
  }
});

test('search finds a literal across a block boundary in chapter 600', async () => {
  const prefix = '\u0130' + 'x'.repeat(32765) + '\u{1f4da}';
  let result;
  let reads = 0;
  await searchBook(
    chapters,
    '[end]',
    async (index) => {
      reads++;
      return index === 599 ? prefix.slice(0, -2) + '[END]' + prefix.slice(-2) : 'other';
    },
    () => false,
    (rows) => {
      result = rows;
    },
  );
  assert.equal(reads, 600);
  assert.equal(result[0].chapterIndex, 599);
  assert.equal(result[0].chapterOffset, prefix.length - 2);
  assert.equal(result[0].match, '[END]');
});

test('search stops reading at the cap and when a newer query supersedes it', async () => {
  let reads = 0;
  let count = 0;
  const read = async () => {
    reads++;
    return 'same same\n'.repeat(100);
  };
  await searchBook(
    chapters,
    'same',
    read,
    () => false,
    (rows) => {
      count = rows.length;
    },
  );
  assert.equal(count, 200);
  assert.equal(reads, 2);
  reads = 0;
  await searchBook(
    chapters,
    'same',
    read,
    () => reads >= 1,
    () => assert.fail('stale result'),
  );
  assert.equal(reads, 1);
});

test('an unreadable chapter does not hide matches later in the book', async () => {
  let result;
  const skipped = await searchBook(
    chapters.slice(0, 2),
    'word',
    async (index) => {
      if (!index) throw Error('missing file');
      return '\u{1f4da} word';
    },
    () => false,
    (rows) => {
      result = rows;
    },
  );
  assert.equal(skipped, 1);
  assert.equal(result[0].chapterOffset, 3);
});
