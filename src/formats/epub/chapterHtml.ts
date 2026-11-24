import * as htmlparser2 from 'htmlparser2';
import { normalizeText } from '../../text/normalize.ts';
import { PRESENTATION_VERSION } from '../types.ts';
import type { ChapterImage, ChapterNavigation, ChapterParagraph, PublisherStyle } from '../types';
import { chapterStyleRules, resourcePath, styledElement, type PublicationAssets } from './publisherStyle.ts';

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'tr', 'section', 'article',
  'header', 'footer', 'aside', 'nav', 'main', 'figure', 'figcaption',
]);

const IGNORE_TAGS = new Set(['head', 'style', 'script', 'svg', 'noscript']);

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/\u00AD/g, ''); // soft hyphen
}

interface Mark { offset: number }

type ListItem = { type: string; value?: number; paragraph?: ChapterParagraph };
type HtmlElement = ReturnType<typeof styledElement> & {
  started?: boolean;
  items?: ListItem[];
  item?: ListItem;
};

function integer(value?: string) {
  return value && /^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

function listLabel(type: string, n: number) {
  if (type === 'none') return undefined;
  if (type === 'disc') return '•';
  if (type === 'circle') return '◦';
  if (type === 'square') return '▪';
  if (n > 0 && /^(lower|upper)-(alpha|latin)$/.test(type)) {
    let label = '';
    for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) label = String.fromCharCode(97 + (i - 1) % 26) + label;
    return (type.startsWith('upper') ? label.toUpperCase() : label) + '.';
  }
  if (n > 0 && n < 4000 && /^(lower|upper)-roman$/.test(type)) {
    let label = '';
    for (const [value, glyph] of [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']] as const) {
      while (n >= value) { label += glyph; n -= value; }
    }
    return (type.startsWith('upper') ? label.toUpperCase() : label) + '.';
  }
  return n + '.';
}

/** Move sorted UTF-16 boundaries through the same replacements used to produce the text. */
function replaceMarked(text: string, marks: Mark[], pattern: RegExp, value: string) {
  let next = 0;
  let delta = 0;
  const result = text.replace(pattern, (match: string, at: number) => {
    while (next < marks.length && marks[next].offset <= at) marks[next++].offset += delta;
    while (next < marks.length && marks[next].offset < at + match.length) {
      marks[next++].offset = at + delta + value.length;
    }
    delta += value.length - match.length;
    return value;
  });
  while (next < marks.length) marks[next++].offset += delta;
  return result;
}

function normalizeMarked(text: string, marks: Mark[]) {
  const nfc = text.normalize('NFC');
  if (marks.length && nfc !== text) {
    // Canonically equivalent text has the same decomposed length. Walk it once on
    // each side, including when markup splits a base character and combining mark.
    let source = 0, sourceUnits = 0, dest = 0, destUnits = 0;
    for (const mark of marks) {
      while (source < mark.offset) {
        const char = String.fromCodePoint(text.codePointAt(source)!);
        source += char.length;
        sourceUnits += char.normalize('NFD').length;
      }
      while (destUnits < sourceUnits && dest < nfc.length) {
        const char = String.fromCodePoint(nfc.codePointAt(dest)!);
        dest += char.length;
        destUnits += char.normalize('NFD').length;
      }
      mark.offset = dest;
    }
  }
  text = replaceMarked(nfc, marks, /\uFEFF/g, '');
  text = replaceMarked(text, marks, /\r\n|\r/g, '\n');
  text = replaceMarked(text, marks, /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  return replaceMarked(text, marks, /^\n+|\n+$/g, '');
}

export function extractChapterHtml(html: string, chapter = '', assets?: PublicationAssets) {
  const rules = chapterStyleRules(html, chapter, assets);
  const elements: HtmlElement[] = [];
  const layout: ChapterParagraph[] = [];
  let currentBlock: ChapterParagraph | undefined;
  let pendingGap = 0;
  let blankLines = 0;
  let lastWasBreak = false;
  const styles: { start: Mark; end: Mark; style: PublisherStyle }[] = [];
  const images: { point: Mark; image: Omit<ChapterImage, 'offset'> }[] = [];
  const paragraphs: string[] = [];
  let currentPara: string[] = [];
  let ignoreDepth = 0;
  let inSvg = false;
  let inPre = false;
  let headingDepth = 0;
  let headingBuffer: string[] = [];
  let firstHeading: string | undefined;

  const marks: Mark[] = [];
  let localMarks: Mark[] = [];
  let paragraphLength = 0;
  let joinedLength = 0;
  const anchors: [string, Mark][] = [];
  const spans: { start: Mark; end: Mark; href: string }[] = [];
  let active: { start: Mark; href: string } | undefined;

  function mark() {
    const point = { offset: paragraphLength };
    localMarks.push(point);
    return point;
  }

  function startBlock() {
    const list = elements.findLast((el) => el.item)?.item;
    const indent = elements.filter((el) => el.tag === 'blockquote' || el.items).length;
    let gap = pendingGap;
    for (const el of elements) {
      if (!el.started && (BLOCK_TAGS.has(el.tag) || el.items)) gap = Math.max(gap, el.block.before ?? 0);
      el.started = true;
    }
    currentBlock = { offset: 0, gap, blankLines, indent };
    const heading = elements.findLast(el => /^h[1-6]$/.test(el.tag) || el.attrs.role === 'heading');
    if (heading) {
      currentBlock.heading = true;
      currentBlock.align = elements.findLast(el => el.block.align)?.block.align;
      currentBlock.ruleBelow = heading.block.ruleBelow;
      const scale = heading.style.scale ?? 1;
      if (heading.block.widthEm != null) currentBlock.widthEm = heading.block.widthEm * scale;
      currentBlock.maxWidthPercent = heading.block.maxWidthPercent;
      currentBlock.centerBlock = heading.block.centerBlock;
      if (heading.block.paddingBelow != null) currentBlock.paddingBelow = heading.block.paddingBelow * scale;
      if (heading.style.scale === 0 || elements.some(el => el.block.hidden)) currentBlock.hidden = true;
    }
    if (list && !list.paragraph) list.paragraph = currentBlock;
    pendingGap = blankLines = 0;
    lastWasBreak = false;
  }

  const flushPara = () => {
    let line = currentPara.join('');
    if (!inPre) {
      line = replaceMarked(line, localMarks, /[ \t\r\n]+/g, ' ');
      line = replaceMarked(line, localMarks, /^\s+|\s+$/g, '');
    }
    if (line.length) {
      const base = joinedLength + (paragraphs.length ? 1 : 0);
      if (currentBlock) {
        currentBlock.offset = base;
        layout.push(currentBlock);
        marks.push(currentBlock);
      }
      for (const point of localMarks) {
        point.offset += base;
        marks.push(point);
      }
      localMarks = [];
      paragraphs.push(line);
      joinedLength = base + line.length;
    }
    currentPara = [];
    currentBlock = undefined;
    paragraphLength = 0;
  };

  const parser = new htmlparser2.Parser(
    {
      onopentag(name, attrs) {
        const tag = name.toLowerCase();
        if ((tag === 'img' && !ignoreDepth) || (tag === 'image' && ignoreDepth === 1 && inSvg)) {
          const ref = attrs.src || attrs.href || attrs['xlink:href'];
          const asset = assets?.images.get(resourcePath(chapter, ref));
          if (asset) {
            for (const el of elements) el.started = true;
            const aspect = Number(attrs.width) / Number(attrs.height);
            images.push({ point: mark(), image: { file: asset.file, alt: attrs.alt || attrs.title || '',
              href: active?.href, aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : asset.aspect } });
          }
        }
        if (IGNORE_TAGS.has(tag)) {
          if (tag === 'svg' && !ignoreDepth) inSvg = true;
          ignoreDepth++;
          return;
        }
        if (ignoreDepth > 0) return;
        const element: HtmlElement = styledElement(tag, attrs, elements, rules);
        if (tag === 'ol' || tag === 'ul') element.items = [];
        if (tag === 'li') {
          const list = elements.findLast((el) => el.items);
          if (list?.items) {
            const types: Record<string, string> = { a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', '1': 'decimal' };
            const type = attrs.type ?? list.attrs.type;
            const depth = elements.filter((el) => el.items).length;
            element.item = { type: element.block.listType ?? list.block.listType ?? types[type] ?? type
              ?? (list.tag === 'ol' ? 'decimal' : ['disc', 'circle', 'square'][(depth - 1) % 3]), value: integer(attrs.value) };
            list.items.push(element.item);
          }
        }
        elements.push(element);

        if (tag === 'pre') inPre = true;

        if (BLOCK_TAGS.has(tag) || tag === 'br') {
          flushPara();
        }
        if (tag === 'br') {
          if (lastWasBreak || !elements.findLast((el) => BLOCK_TAGS.has(el.tag))?.started) blankLines++;
          lastWasBreak = true;
        }

        const id = attrs.id || attrs['xml:id'] || (tag === 'a' && attrs.name);
        if (id) anchors.push([id, mark()]);
        if (tag === 'a' && attrs.href?.trim()) active = { start: mark(), href: attrs.href.trim() };

        if (/^h[1-6]$/.test(tag) && !firstHeading) {
          headingDepth++;
        }
      },
      ontext(text) {
        if (ignoreDepth > 0) return;
        const decoded = decodeHtmlEntities(text);
        if (!currentBlock && (inPre || /\S/.test(decoded))) startBlock();
        const style = elements.at(-1)?.style;
        const start = style && Object.values(style).some(Boolean) ? mark() : null;
        currentPara.push(decoded);
        paragraphLength += decoded.length;
        if (start && style) styles.push({ start, end: mark(), style });
        if (headingDepth > 0 && !firstHeading) {
          headingBuffer.push(decoded);
        }
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (IGNORE_TAGS.has(tag)) {
          if (ignoreDepth > 0) ignoreDepth--;
          if (!ignoreDepth) inSvg = false;
          return;
        }
        if (ignoreDepth > 0) return;
        const element = elements.pop();
        if (element?.items) {
          pendingGap = Math.max(pendingGap, element.block.after ?? 0);
          const reversed = 'reversed' in element.attrs;
          let n = integer(element.attrs.start) ?? (reversed ? element.items.length : 1);
          for (const item of element.items) {
            n = item.value ?? n;
            if (item.paragraph) item.paragraph.marker = listLabel(item.type, n);
            n += reversed ? -1 : 1;
          }
        }

        if (tag === 'a' && active) {
          spans.push({ ...active, end: mark() });
          active = undefined;
        }
        if (tag === 'pre') inPre = false;

        if (BLOCK_TAGS.has(tag)) {
          flushPara();
          if (tag === 'p' && !element?.started) blankLines++;
          pendingGap = Math.max(pendingGap, element?.block.after ?? (tag === 'p' && !elements.some((el) => el.item) ? 0.6 : 0));
          lastWasBreak = false;
        }

        if (/^h[1-6]$/.test(tag) && headingDepth > 0) {
          headingDepth--;
          if (headingDepth === 0 && !firstHeading) {
            const h = headingBuffer.join('').replace(/\s+/g, ' ').trim();
            if (h.length > 0 && h.length < 120) {
              firstHeading = h;
            }
            headingBuffer = [];
          }
        }
      },
    },
    { decodeEntities: true }
  );

  parser.write(html);
  parser.end();
  flushPara();

  for (const point of localMarks) {
    point.offset = joinedLength;
    marks.push(point);
  }
  const joined = paragraphs.join('\n');
  const text = marks.length ? normalizeMarked(joined, marks) : normalizeText(joined);
  const navigation: ChapterNavigation = {
    presentationVersion: PRESENTATION_VERSION,
    paragraphs: layout,
    styles: styles.filter(({ start, end }) => end.offset > start.offset)
      .map(({ start, end, style }) => ({ start: start.offset, end: end.offset, style })),
    images: images.map(({ point, image }) => ({ offset: point.offset, ...image })),
    links: spans.filter(({ start, end }) => end.offset > start.offset).map(({ start, end, href }) =>
      ({ start: start.offset, end: end.offset, href })),
    anchors: anchors.map(([name, point]) => [name, point.offset]),
  };
  return { text, firstHeading, navigation };
}
