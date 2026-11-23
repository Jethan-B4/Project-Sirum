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

test('EPUB link ranges preserve repeated labels and exact normalized UTF-16 offsets', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const html = '<p>  \u{1f4da}  <a href="../b.xhtml#foot">see <b>this</b></a> see this</p>' +
    '<a name="here"></a><p id="end">e\u0301 <a href="https://example.org">see this</a></p>';
  const { text, navigation } = extractChapterHtml(html);
  assert.equal(text, '\u{1f4da} see this see this\n\u00e9 see this');
  assert.deepEqual(navigation.links.map(({start, end}) => text.slice(start, end)), ['see this', 'see this']);
  assert.equal(navigation.links[1].start, text.lastIndexOf('see this'));
  assert.deepEqual(navigation.anchors, [['here', text.indexOf('\u00e9')], ['end', text.indexOf('\u00e9')]]);
});

test('reader resolves book fragments and keeps external links separate', async () => {
  const { resolveBookLink, plainLinks, linksInRange } = await import('../src/text/links.ts');
  const sources = ['text/intro.xhtml', 'notes/end%20notes.xhtml'];
  const resolve = (href) => resolveBookLink(href, sources[0], sources, 'OPS');
  assert.deepEqual(resolve('../notes/end%20notes.xhtml#n1'), {kind: 'internal', index: 1, fragment: 'n1', address: 'OPS/notes/end notes.xhtml#n1'});
  assert.equal(resolve('#local').index, 0);
  assert.equal(resolve('https://example.org/test').kind, 'external');
  assert.equal(resolve('notes.xhtml').kind, 'supplement');
  assert.equal(resolve('javascript:alert(1)').kind, 'missing');
  const [link] = plainLinks('A https://example.org/test. End');
  assert.equal(link.href, 'https://example.org/test');
  assert.deepEqual(linksInRange([link], link.start+2, link.end), [link]);
  assert.deepEqual(linksInRange([link], link.end, link.end+4), []);
});

test('accent foregrounds stay readable for light, dark, and middle-luminance fills', async () => {
  const { contrastText, linkColor, relativeLuminance } = await import('../src/lib/color.ts');
  for (const bg of ['#ffffff','#000000','#777777','#52c98b','#5b46c9','#bfeacf','#1b66b8']) {
    const l = [relativeLuminance(bg), relativeLuminance(contrastText(bg))].sort((a,b)=>b-a);
    assert.ok((l[0]+0.05)/(l[1]+0.05) >= 4.5);
  }
  for (const bg of ['#ffffff', '#000000', '#2b2b2e', '#f1e4c3', '#777777']) {
    const [low, high] = [bg, linkColor(bg)].map(relativeLuminance).sort((a, b) => a - b);
    assert.ok((high + 0.05) / (low + 0.05) >= 4.5);
  }
});
