import { Parser } from 'htmlparser2';
import type { ChapterParagraph, PublisherStyle } from '../types';

export interface PublicationAssets {
  css: Map<string, string>;
  images: Map<string, { file: string; aspect?: number }>;
}

/** Resolve a publication resource inside the archive. Archive names never become filesystem paths. */
export function resourcePath(chapter: string, href: string) {
  if (!href || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href)) return '';
  try {
    const base = 'https://epub.invalid/' + chapter.split('/').map(encodeURIComponent).join('/');
    const url = new URL(href, base);
    return url.origin === 'https://epub.invalid' ? decodeURIComponent(url.pathname.slice(1)) : '';
  } catch { return ''; }
}

type BlockStyle = Pick<ChapterParagraph, 'align' | 'ruleBelow' | 'hidden' | 'widthEm' | 'maxWidthPercent' | 'centerBlock' | 'paddingBelow'> & {
  before?: number; after?: number; listType?: string;
};
type Element = { tag: string; attrs: Record<string, string>; style: PublisherStyle; block: BlockStyle };
// Each group is a direct-child chain. Whitespace between groups permits any ancestor.
// Both groups and their members are stored right-to-left to match from the styled element.
type Rule = { groups: string[][]; weight: number; declarations: string };
const parsedSheets = new WeakMap<PublicationAssets, Map<string, Rule[]>>();

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let depth = 0, start = 0, opening = 0;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < css.length; i++) {
    if (css[i] === ';' && !depth) start = i + 1;
    if (css[i] === '{' && depth++ === 0) opening = i;
    if (css[i] !== '}' || --depth !== 0) continue;
    for (const selector of css.slice(start, opening).trim().split(',')) {
      const groups = selector.trim().replace(/\s*>\s*/g, '>').split(/\s+/)
        .reverse().map((group) => group.split('>').reverse());
      const selectors = groups.flat();
      if (!selectors.every((part) => /^(?:\*|[a-z][\w-]*)?(?:[.#][\w-]+)*$/i.test(part) && part)) continue;
      const weight = selectors.reduce((n, part) => n + (part.match(/#/g)?.length ?? 0) * 100
        + (part.match(/\./g)?.length ?? 0) * 10 + Number(/^[a-z]/i.test(part)), 0);
      rules.push({ groups, weight, declarations: css.slice(opening + 1, i) });
    }
    start = i + 1;
  }
  return rules;
}

export function chapterStyleRules(html: string, chapter: string, assets?: PublicationAssets) {
  if (!/<(?:style|link)\b/i.test(html)) return [];
  const rules: Rule[] = [];
  let inline: string | undefined;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'style') inline = '';
      if (assets && tag === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet')) {
        const path = resourcePath(chapter, attrs.href);
        const sheet = assets.css.get(path);
        if (!sheet) return;
        let cache = parsedSheets.get(assets);
        if (!cache) { cache = new Map(); parsedSheets.set(assets, cache); }
        let parsed = cache.get(path);
        if (!parsed) { parsed = parseRules(sheet); cache.set(path, parsed); }
        rules.push(...parsed);
      }
    },
    ontext(value) { if (inline !== undefined) inline += value; },
    onclosetag(tag) {
      if (tag === 'style' && inline !== undefined) { rules.push(...parseRules(inline)); inline = undefined; }
    },
  });
  parser.end(html);
  return rules.sort((a, b) => a.weight - b.weight);
}

function matches(element: Element, selector: string) {
  const tag = selector.match(/^[\w-]+/)?.[0];
  if (tag && tag.toLowerCase() !== element.tag) return false;
  return (selector.match(/[.#][\w-]+/g) ?? []).every((token) => token[0] === '#'
    ? element.attrs.id === token.slice(1) : element.attrs.class?.split(/\s+/).includes(token.slice(1)));
}

function matchesRule(element: Element, parents: Element[], groups: string[][]) {
  let at = parents.length;
  for (const [index, chain] of groups.entries()) {
    while (true) {
      if (at + 1 < chain.length) return false;
      if (chain.every((selector, offset) => matches(parents[at - offset] ?? element, selector))) break;
      if (index === 0) return false;
      at--;
    }
    at -= chain.length;
  }
  return true;
}

function spacing(value: string) {
  const match = /^(\d*\.?\d+)(em|rem|px|pt)?$/.exec(value);
  if (!match || (!match[2] && Number(match[1]) !== 0)) return undefined;
  return Math.min(4, Number(match[1]) / (match[2] === 'px' ? 16 : match[2] === 'pt' ? 12 : 1));
}

function apply(style: PublisherStyle, block: BlockStyle, declarations: string, parentScale: number) {
  for (const decl of declarations.toLowerCase().split(';')) {
    const [name, value] = decl.split(':').map((s) => s.trim());
    if (!value) continue;
    if (name === 'text-align' && (value === 'left' || value === 'right' || value === 'center' || value === 'justify')) block.align = value;
    if (name === 'font-variant' || name === 'font-variant-caps') style.smallCaps = value === 'small-caps';
    if (name === 'display') block.hidden = value === 'none';
    if (name === 'width' && /^\d*\.?\d+em$/.test(value)) block.widthEm = parseFloat(value);
    if (name === 'max-width' && /^\d*\.?\d+%$/.test(value)) block.maxWidthPercent = Math.min(100, parseFloat(value));
    if (name === 'padding-bottom') block.paddingBelow = spacing(value);
    if (name === 'border-bottom') {
      const width = value.match(/(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|$)/);
      block.ruleBelow = /\bsolid\b/.test(value) ? Math.min(4, width ? Number(width[1]) : 1) : 0;
    }
    if (name === 'font-size' && /^0(?:px|em|%)?$/.test(value)) style.scale = 0;
    if (name === 'margin' || name === 'margin-block') {
      const sides = value.split(/\s+/);
      if (name === 'margin') block.centerBlock = sides[1] === 'auto' && (sides[3] ?? sides[1]) === 'auto';
      const before = spacing(sides[0]);
      const after = spacing((name === 'margin' ? sides[2] : sides[1]) ?? sides[0]);
      if (before !== undefined) block.before = before;
      if (after !== undefined) block.after = after;
    }
    if (name === 'margin-top' || name === 'margin-block-start') block.before = spacing(value) ?? block.before;
    if (name === 'margin-bottom' || name === 'margin-block-end') block.after = spacing(value) ?? block.after;
    if (name === 'list-style-type') block.listType = value;
    if (name === 'list-style') {
      const type = value.split(/\s+/).find((part) => /^(none|disc|circle|square|decimal|(lower|upper)-(alpha|latin|roman))$/.test(part));
      if (type) block.listType = type;
    }
    if (name === 'font-weight') style.bold = value === 'bold' || value === 'bolder' || Number(value) >= 600;
    if (name === 'font-style') style.italic = value === 'italic' || value === 'oblique';
    if (name === 'text-decoration' || name === 'text-decoration-line') {
      style.underline = value?.includes('underline');
      style.strike = value?.includes('line-through');
    }
    if (name === 'font-size' && /^\d*\.?\d+(em|%)$/.test(value)) {
      style.scale = parentScale * parseFloat(value) / (value.endsWith('%') ? 100 : 1);
    }
  }
}

export function styledElement(tag: string, attrs: Record<string, string>, parents: Element[], rules: Rule[]): Element {
  const style = { ...parents.at(-1)?.style };
  const parentScale = style.scale ?? 1;
  const block: BlockStyle = {};
  const element = { tag, attrs, style, block };
  if (/^(b|strong|h[1-6])$/.test(tag)) style.bold = true;
  if (/^(i|em|cite)$/.test(tag)) style.italic = true;
  if (/^(s|del|strike)$/.test(tag)) style.strike = true;
  if (tag === 'u') style.underline = true;
  if (/^h[1-6]$/.test(tag)) style.scale = parentScale * [1.55, 1.4, 1.25, 1.15, 1.1, 1][Number(tag[1]) - 1];
  if (tag === 'small') style.scale = parentScale * 0.85;
  for (const { groups, declarations } of rules) {
    if (matchesRule(element, parents, groups)) apply(style, block, declarations, parentScale);
  }
  if (attrs.style) apply(style, block, attrs.style, parentScale);
  if (style.scale) style.scale = Math.max(0.7, Math.min(2, style.scale));
  return element;
}
