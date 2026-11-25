import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkChapter, findChunkForOffset, paragraphRows, plainParagraphs } from '../src/text/chunk.ts';
import { resumePosition } from '../src/features/reader/resume.ts';
import { bookSliderDestination, displayPercent } from '../src/text/position.ts';
import { searchBook } from '../src/features/reader/searchBook.ts';
import { createChapterCache } from '../src/features/reader/chapterCache.ts';

test('dismissing distant previews releases their chapters, while a committed jump keeps its neighbors', async () => {
  const reads = [];
  const cache = createChapterCache(async index => {
    reads.push(index);
    return { index };
  }, () => true);
  cache.focus(2);
  const neighbor = cache.load(3);
  assert.equal(cache.load(3), neighbor);
  await neighbor;
  const preview = await cache.load(45);
  assert.notEqual(await cache.load(45), preview);
  cache.focus(45, preview);
  assert.equal(await cache.load(45), preview);
  await cache.load(3);
  assert.deepEqual(reads, [3, 45, 45, 3]);
});

test('stale preload failures preserve newer reads and incomplete presentation can be retried', async () => {
  const requests = [];
  const cache = createChapterCache(() => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    page => !!page.nav);
  const stale = cache.load(1);
  cache.focus(8);
  cache.focus(0);
  const replacement = cache.load(1);
  requests[0].reject(new Error('read failed'));
  await assert.rejects(stale, /read failed/);
  assert.equal(cache.load(1), replacement);
  requests[1].resolve({ nav: null });
  assert.equal((await replacement).nav, null);
  const retry = cache.load(1);
  requests[2].resolve({ nav: {} });
  assert.deepEqual(await retry, { nav: {} });
  assert.equal(cache.load(1), retry);
});

const chapters = Array.from({ length: 600 }, (_, i) => ({
  chapter_index: i,
  title: 'Chapter ' + (i + 1),
  start_offset: i * 2000,
  char_count: 2000,
}));

test('book scrubber seeks across uneven chapters and includes textless endpoint covers', () => {
  const rows = [0, 300, 100, 0].map((char_count, index) => ({ char_count, start_offset: [0, 0, 300, 400][index] }));
  for (const [value, index, fraction] of [[0, 0, 0], [37.5, 1, 0.5], [75, 2, 0], [87.5, 2, 0.5], [100, 3, 1]]) {
    assert.deepEqual(bookSliderDestination(value, rows, 400), { index, fraction });
  }
  assert.equal(displayPercent(0.999), 99);
  assert.equal(displayPercent(1), 100);
});

test('centered EPUB part titles retain their alignment, scale and canonical offsets', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const { text, navigation } = extractChapterHtml('<style>.MsoNormal4{text-align:center}.large{font-size:1.67em}</style>' +
    '<p class="MsoNormal4"><b><span class="large">PART I</span></b></p>' +
    '<p class="MsoNormal4"><b><span class="large">“THE SPARK”</span></b></p><p>Body</p>');
  assert.equal(text, 'PART I\n“THE SPARK”\nBody');
  assert.deepEqual(navigation.paragraphs.map(p => [p.offset, p.align]), [[0, 'center'], [7, 'center'], [19, undefined]]);
  assert.ok(navigation.styles.some(span => span.style.scale === 1.67 && span.style.bold));
});

test('plain-text indentation uses real paragraph starts across chunk cuts and blank lines', () => {
  const text = '🦊'.repeat(1900) + '\n\n  Typed leading spaces\n' + 'More\n'.repeat(65);
  const paragraphs = plainParagraphs(text);
  const rows = chunkChapter(0, text, 0, [], paragraphs).flatMap(chunk => paragraphRows(chunk, paragraphs));
  assert.equal(rows.map(row => row.text).join(''), text);
  assert.deepEqual(rows.filter(row => row.first).map(row => row.startOffset), paragraphs.map(p => p.offset));
  assert.ok(rows.some(row => !row.first && row.text.startsWith('🦊')));
  assert.equal(rows.find(row => row.text.startsWith('  Typed')).startOffset, text.indexOf('  Typed'));
});

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
  const { resolveBookLink, plainLinks, linksInRange, linkedPassage } = await import('../src/text/links.ts');
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
  const note = 'Opening text\nA complete linked note with all of its explanation.\nFollowing text';
  const noteOffset = note.indexOf('linked');
  assert.equal(linkedPassage(note, noteOffset, [
    { offset: 0 }, { offset: note.indexOf('A complete') }, { offset: note.indexOf('Following') },
  ]), 'A complete linked note with all of its explanation.');
  assert.equal(linkedPassage('First line\nSecond linked line\nThird line', 14), 'Second linked line');
});

test('preview paragraphs include embedded newlines and support incomplete legacy layout data', async () => {
  const { linkedPassage } = await import('../src/text/links.ts');
  const text = 'First\nSecond\nA note\nwith a line break\nLast.';
  const note = text.indexOf('A note');
  const last = text.indexOf('Last.');
  const rows = [{ offset: note }, { offset: last }];
  assert.equal(linkedPassage(text, 0, rows), 'First');
  assert.equal(linkedPassage(text, note, rows), 'A note\nwith a line break');
  assert.equal(linkedPassage(text, last - 1, rows), 'A note\nwith a line break');
  assert.equal(linkedPassage(text, text.length, rows), 'Last.');
  assert.equal(linkedPassage('', 0), '');
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

test('publisher CSS, emphasis, images and links share normalized chapter offsets', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const assets = {
    css: new Map([['OPS/theme.css', '.poem .voice {font-style: italic} #lead {font-weight:bold; color:white}']]),
    images: new Map([['OPS/art/sun rise.png', {file: 'media-0.png', aspect: 2}]]),
  };
  const source = '<head><link rel="stylesheet" href="../theme.css"/><style>.note {text-decoration:underline}</style></head>' +
    '<section class="poem"><h2>Title</h2><p id="lead">A <a class="voice" href="#end">linked phrase</a>.</p>' +
    '<figure><a href="#end"><img src="../art/sun%20rise.png" alt="Sunrise"/></a></figure>' +
    '<p class="note" id="end" style="font-size:120%">Cafe\u0301</p></section>';
  const { text, navigation } = extractChapterHtml(source, 'OPS/body/ch.xhtml', assets);
  assert.equal(text, 'Title\nA linked phrase.\nCaf\u00e9');
  const span = (label) => navigation.styles.find(s => text.slice(s.start, s.end) === label).style;
  assert.equal(span('Title').bold, true);
  assert.deepEqual(span('linked phrase'), {bold: true, italic: true});
  assert.equal(span('Caf\u00e9').scale, 1.2);
  assert.equal(span('Caf\u00e9').underline, true);
  assert.equal(navigation.links.length, 1);
  assert.deepEqual(navigation.images, [{offset: text.indexOf('Caf'), alt:'Sunrise', file:'media-0.png', href:'#end', aspect:2}]);
  const chunks = chunkChapter(0, text, 0, navigation.images);
  assert.equal(chunks.map(c => c.text).join(''), text);
  assert.equal(chunks[1].image.file, 'media-0.png');
  assert.equal(chunks[2].startOffset, navigation.anchors.find(([id]) => id === 'end')[1]);
});

test('image-only reflowable pages have a renderable chunk without inserting characters', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const assets = {css: new Map(), images: new Map([['cover.jpg', {file: 'media-1.jpg'}]])};
  const {text, navigation} = extractChapterHtml('<svg><image xlink:href="cover.jpg"/></svg>' +
    '<img src="https://example.org/cover.jpg"/>', 'page.xhtml', assets);
  assert.equal(text, '');
  const chunks = chunkChapter(0, text, 0, navigation.images);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].image.file, 'media-1.jpg');
  assert.equal(chunks[0].startOffset, 0);
});

test('EPUB paragraph gaps, explicit blank lines and nested lists share stable source positions', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const source = '<style>p {margin: 0} .spaced {margin-bottom: 2em} ol {list-style-type: upper-alpha}</style>' +
    '<p class="spaced">Cafe\u0301</p><p>Second<br/>line<br/><br/>verse</p><p>&nbsp;</p>' +
    '<ol start="26"><li><p>First</p><p>continued</p><ul><li>Nested</li></ul></li>' +
    '<li value="28"><a href="#note">Next</a></li></ol><blockquote id="note"><p>Quote</p></blockquote>';
  const { text, navigation } = extractChapterHtml(source);
  assert.equal(text, 'Café\nSecond\nline\nverse\nFirst\ncontinued\nNested\nNext\nQuote');
  const rows = paragraphRows(chunkChapter(0, text, 0)[0], navigation.paragraphs);
  const blocks = Object.fromEntries(rows.map((row) => [row.text.trim(), row.paragraph]));
  assert.equal(blocks.Second.gap, 2);
  assert.equal(blocks.line.gap, 0);
  assert.equal(blocks.verse.blankLines, 1);
  assert.equal(blocks.First.blankLines, 1);
  assert.equal(blocks.First.marker, 'Z.');
  assert.equal(blocks.continued.marker, undefined);
  assert.equal(blocks.continued.indent, 1);
  assert.equal(blocks.Nested.indent, 2);
  assert.equal(blocks.Nested.marker, '◦');
  assert.equal(blocks.Next.marker, 'AB.');
  assert.equal(blocks.Quote.indent, 1);
  assert.equal(navigation.links[0].start, text.indexOf('Next'));
  assert.equal(navigation.anchors[0][1], text.indexOf('Quote'));
  assert.equal(rows.map(row => row.text).join(''), text);
});

test('publisher child selectors style only matching paragraphs and list items', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const source = '<style>.chapter > .verse p > em {font-weight:bold}' +
    'ol.steps>li {list-style-type:upper-roman}</style>' +
    '<section class="chapter"><div class="verse"><div class="verse"><p><em>Direct</em> ' +
    '<span><em>nested</em></span></p></div></div></section>' +
    '<ol class="steps"><li>Outer<ul><li>Inner</li></ul></li></ol>';
  const { text, navigation } = extractChapterHtml(source);
  assert.equal(text, 'Direct nested\nOuter\nInner');
  const span = (label) => navigation.styles.find(({ start, end }) => text.slice(start, end) === label).style;
  assert.deepEqual(span('Direct'), { bold: true, italic: true });
  assert.deepEqual(span('nested'), { italic: true });
  assert.deepEqual(navigation.paragraphs.map(p => p.marker), [undefined, 'I.', '◦']);
});

test('EPUB heading layout preserves publisher alignment, ornament and hidden navigation labels', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const { text, navigation } = extractChapterHtml('<style>h2 { text-align:center; margin:1em auto; ' +
    'font-size:150%; font-variant:small-caps; border-bottom:2px solid; width:15em; max-width:80%; padding-bottom:0.3em }' +
    '.epub-invis { font-size:0 }</style><h1 class="epub-invis" id="anchor">TOC label</h1>' +
    '<h2>The <em>crossing</em></h2><p>First paragraph.</p>');
  assert.equal(text, 'TOC label\nThe crossing\nFirst paragraph.');
  const [hidden, heading, body] = navigation.paragraphs;
  assert.equal(hidden.hidden, true);
  assert.deepEqual(navigation.anchors, [['anchor', 0]]);
  assert.equal(heading.offset, text.indexOf('The crossing'));
  assert.equal(heading.align, 'center');
  assert.equal(heading.widthEm, 22.5);
  assert.equal(heading.centerBlock, true);
  assert.equal(heading.maxWidthPercent, 80);
  assert.equal(heading.ruleBelow, 2);
  assert.equal(body.heading, undefined);
  const emphasis = navigation.styles.find(s => text.slice(s.start, s.end) === 'crossing').style;
  assert.deepEqual(emphasis, { bold: true, scale: 1.5, smallCaps: true, italic: true });
});

test('nested EPUB block margins apply once at their first and last paragraphs', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const source = '<p>Before</p><blockquote style="margin-top:2em"><div style="margin-top:1em">' +
    '<p id="first">First</p><p>Second</p></div></blockquote>' +
    '<ul style="margin-block: 3em 2em"><li>Item</li></ul><p><a href="#first">After</a></p>';
  const { text, navigation } = extractChapterHtml(source);
  assert.equal(text, 'Before\nFirst\nSecond\nItem\nAfter');
  assert.deepEqual(navigation.paragraphs.map(p => p.gap), [0, 2, 0.6, 3, 2]);
  assert.equal(navigation.anchors[0][1], text.indexOf('First'));
  assert.equal(text.slice(navigation.links[0].start, navigation.links[0].end), 'After');
});

test('a long EPUB list keeps its numbering through chunk boundaries and renders bounded groups', async () => {
  const { extractChapterHtml } = await import('../src/formats/epub/chapterHtml.ts');
  const source = '<ol reversed>' + '<li>x</li>'.repeat(600) + '<li>' + 'y'.repeat(6400) + '</li></ol>';
  const { text, navigation } = extractChapterHtml(source);
  const chunks = chunkChapter(0, text, 0, [], navigation.paragraphs);
  const rows = chunks.flatMap(chunk => {
    const group = paragraphRows(chunk, navigation.paragraphs);
    assert.ok(group.length <= 40);
    return group;
  });
  assert.equal(rows.map(row => row.text).join(''), text);
  assert.equal(rows[0].paragraph.marker, '601.');
  assert.equal(rows.filter(row => row.first).length, 601);
  assert.equal(rows.at(-1).paragraph.marker, '1.');
  assert.equal(rows.at(-1).first, false);
});

test('TXT keeps typed bullets, indentation and internal blank lines across native text chunks', async () => {
  const { normalizeText } = await import('../src/text/normalize.ts');
  const source = 'x'.repeat(2998) + '\r\n\r\n  • first\r\n    - nested\r\n\r\n\r\n2. second';
  const text = normalizeText(source);
  const chunks = chunkChapter(0, text, 0);
  assert.equal(chunks.map(chunk => chunk.text).join(''), source.replaceAll('\r\n', '\n'));
  assert.deepEqual(chunks.map(chunk => chunk.text.replace(/\n$/, '')).join('\n'), text);
});
