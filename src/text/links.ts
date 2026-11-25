import type { BookLink } from '../formats/types';

export function plainLinks(text: string): BookLink[] {
  const links: BookLink[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let href = match[0].replace(/[.,;:!?]+$/, '');
    if (href.endsWith(')') && href.split(')').length > href.split('(').length) href = href.slice(0, -1);
    links.push({ start: match.index, end: match.index + href.length, href });
  }
  return links;
}

export function linkedPassage(text: string, offset: number, paragraphs: readonly { offset: number }[] = []) {
  const position = Math.max(0, Math.min(text.length, offset));
  let lo = 0, hi = paragraphs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (paragraphs[mid].offset <= position) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) return text.slice(paragraphs[lo - 1].offset, paragraphs[lo]?.offset).trim();

  // Legacy imports can have text without paragraph metadata.
  const start = position === 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1;
  const end = text.indexOf('\n', position);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

export function resolveBookLink(href: string, source: string, sources: (string | null)[], dir = '') {
  if (/^(https?:|mailto:|tel:|\/\/)/i.test(href)) {
    const address = href.startsWith('//') ? 'https:' + href : href;
    try { return { kind: 'external', address: new URL(address).href } as const; }
    catch { return { kind: 'missing', address } as const; }
  }
  if (/^[a-z][\w+.-]*:/i.test(href)) return { kind: 'missing', address: href } as const;
  try {
    const root = 'https://epub.invalid/';
    const base = new URL(dir.split('/').filter(Boolean).map(encodeURIComponent).join('/') + '/', root);
    const target = new URL(href, new URL(source, base));
    const path = decodeURIComponent(target.pathname);
    const index = sources.findIndex((item) => item != null && decodeURIComponent(new URL(item, base).pathname) === path);
    if (target.origin !== new URL(root).origin) return { kind: 'missing', address: href } as const;
    if (index < 0) {
      if (!/\.x?html?$/i.test(path)) return { kind: 'missing', address: href } as const;
      return { kind: 'supplement', path: path.slice(1), fragment: decodeURIComponent(target.hash.slice(1)),
        address: path.slice(1) + target.hash } as const;
    }
    return { kind: 'internal', index, fragment: decodeURIComponent(target.hash.slice(1)),
      address: path.slice(1) + target.hash } as const;
  } catch {
    return { kind: 'missing', address: href } as const;
  }
}

/** Find the first link whose end is beyond this visible chunk. */
export function linksInRange<T extends { start: number; end: number }>(links: T[], start: number, end: number) {
  let lo = 0, hi = links.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (links[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  while (lo < links.length && links[lo].start < end) lo++;
  return links.slice(first, lo);
}
