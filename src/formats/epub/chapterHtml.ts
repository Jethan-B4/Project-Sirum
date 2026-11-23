import * as htmlparser2 from 'htmlparser2';
import { normalizeText } from '../../text/normalize.ts';
import type { ChapterNavigation } from '../types';

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

export function extractChapterHtml(html: string) {
  const paragraphs: string[] = [];
  let currentPara: string[] = [];
  let ignoreDepth = 0;
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

  const flushPara = () => {
    let line = currentPara.join('');
    if (!inPre) {
      line = replaceMarked(line, localMarks, /[ \t\r\n]+/g, ' ');
      line = replaceMarked(line, localMarks, /^\s+|\s+$/g, '');
    }
    if (line.length) {
      const base = joinedLength + (paragraphs.length ? 1 : 0);
      for (const point of localMarks) {
        point.offset += base;
        marks.push(point);
      }
      localMarks = [];
      paragraphs.push(line);
      joinedLength = base + line.length;
    }
    currentPara = [];
    paragraphLength = 0;
  };

  const parser = new htmlparser2.Parser(
    {
      onopentag(name, attrs) {
        const tag = name.toLowerCase();
        if (IGNORE_TAGS.has(tag)) {
          ignoreDepth++;
          return;
        }
        if (ignoreDepth > 0) return;

        if (tag === 'pre') inPre = true;

        if (BLOCK_TAGS.has(tag) || tag === 'br') {
          flushPara();
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
        currentPara.push(decoded);
        paragraphLength += decoded.length;
        if (headingDepth > 0 && !firstHeading) {
          headingBuffer.push(decoded);
        }
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (IGNORE_TAGS.has(tag)) {
          if (ignoreDepth > 0) ignoreDepth--;
          return;
        }
        if (ignoreDepth > 0) return;

        if (tag === 'a' && active) {
          spans.push({ ...active, end: mark() });
          active = undefined;
        }
        if (tag === 'pre') inPre = false;

        if (BLOCK_TAGS.has(tag)) {
          flushPara();
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
    links: spans.filter(({ start, end }) => end.offset > start.offset).map(({ start, end, href }) =>
      ({ start: start.offset, end: end.offset, href })),
    anchors: anchors.map(([name, point]) => [name, point.offset]),
  };
  return { text, firstHeading, navigation };
}
