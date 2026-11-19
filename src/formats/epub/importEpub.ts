import { XMLParser } from 'fast-xml-parser';
import * as fflate from 'fflate';
import * as FileSystem from 'expo-file-system/legacy';
import * as htmlparser2 from 'htmlparser2';

import { normalizeText, NORMALIZATION_VERSION } from '@/text/normalize';
import type { Chapter, ImportedBook } from '../types';

interface EpubOpts {
  title: string;
  contentHash: string;
  sizeBytes: number;
}

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

function resolvePath(baseDir: string, relativePath: string): string {
  const clean = decodeURIComponent(relativePath.split('#')[0].split('?')[0]);
  const combined = baseDir ? `${baseDir}/${clean}` : clean;
  const parts = combined.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || !part) continue;
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

function extractTextAndHeadingFromHtml(html: string): { text: string; firstHeading?: string } {
  const paragraphs: string[] = [];
  let currentPara: string[] = [];
  let ignoreDepth = 0;
  let inPre = false;
  let headingDepth = 0;
  let headingBuffer: string[] = [];
  let firstHeading: string | undefined;

  const flushPara = () => {
    if (currentPara.length > 0) {
      const line = currentPara.join('');
      const normalized = inPre ? line : line.replace(/[ \t\r\n]+/g, ' ').trim();
      if (normalized.length > 0) {
        paragraphs.push(normalized);
      }
      currentPara = [];
    }
  };

  const parser = new htmlparser2.Parser(
    {
      onopentag(name) {
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

        if (/^h[1-6]$/.test(tag) && !firstHeading) {
          headingDepth++;
        }
      },
      ontext(text) {
        if (ignoreDepth > 0) return;
        const decoded = decodeHtmlEntities(text);
        currentPara.push(decoded);
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

  const joined = paragraphs.join('\n');
  return {
    text: normalizeText(joined),
    firstHeading,
  };
}

function base64ToUint8Array(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (chars.indexOf(clean[i]) << 18) |
      (chars.indexOf(clean[i + 1]) << 12) |
      ((clean[i + 2] ? chars.indexOf(clean[i + 2]) : 0) << 6) |
      (clean[i + 3] ? chars.indexOf(clean[i + 3]) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

export async function importEpub(uri: string, opts: EpubOpts): Promise<ImportedBook> {
  // Read archive bytes
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const fileBytes = base64ToUint8Array(b64);

  // Unzip all entries synchronously
  let unzipped: fflate.Unzipped;
  try {
    unzipped = fflate.unzipSync(fileBytes);
  } catch {
    throw new Error('Failed to unpack EPUB archive. The file may be damaged or not a valid ZIP.');
  }

  // Normalize path keys
  const zip: Record<string, Uint8Array> = {};
  for (const rawKey of Object.keys(unzipped)) {
    const key = rawKey.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    zip[key] = unzipped[rawKey];
  }

  // 1. Check for DRM
  const encryptionBytes = zip['META-INF/encryption.xml'];
  if (encryptionBytes) {
    const encXml = fflate.strFromU8(encryptionBytes);
    // Font obfuscation algorithms are standard and allowed. Other encryption = DRM.
    const hasDrm = /<(?:\w+:)?EncryptionMethod[^>]+Algorithm=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = hasDrm.exec(encXml)) !== null) {
      const algo = match[1];
      if (
        algo !== 'http://www.idpf.org/2008/embedding' &&
        algo !== 'http://ns.adobe.com/pdf/enc/digital/1.0/'
      ) {
        throw new Error('This EPUB is protected by DRM and cannot be read.');
      }
    }
  }

  // 2. Find package document from META-INF/container.xml
  const containerBytes = zip['META-INF/container.xml'];
  if (!containerBytes) {
    throw new Error('Invalid EPUB: META-INF/container.xml is missing.');
  }
  const containerXml = fflate.strFromU8(containerBytes);
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });
  const containerObj = xmlParser.parse(containerXml);
  const rootfiles = containerObj?.container?.rootfiles?.rootfile;
  const rootfileList = Array.isArray(rootfiles) ? rootfiles : [rootfiles];
  const mainRootfile = rootfileList.find(
    (rf: any) => rf?.['@_media-type'] === 'application/oebps-package+xml' || rf?.['@_full-path']
  );
  const opfPath = (mainRootfile?.['@_full-path'] || 'OEBPS/content.opf')
    .replace(/^\.\//, '')
    .replace(/^\//, '');

  const opfBytes = zip[opfPath];
  if (!opfBytes) {
    throw new Error(`Invalid EPUB: package document at "${opfPath}" not found.`);
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfXml = fflate.strFromU8(opfBytes);
  const opfObj = xmlParser.parse(opfXml);
  const pkg = opfObj?.package;
  if (!pkg) {
    throw new Error('Invalid EPUB: <package> element missing in OPF.');
  }

  // 3. Check for fixed-layout
  const metadata = pkg.metadata || {};
  const metaList = Array.isArray(metadata.meta) ? metadata.meta : metadata.meta ? [metadata.meta] : [];
  for (const m of metaList) {
    if (m?.['@_property'] === 'rendition:layout' && m?.['#text'] === 'pre-paginated') {
      throw new Error('Fixed-layout (pre-paginated) EPUBs are not supported yet.');
    }
  }

  // 4. Extract title & author
  const rawTitle = metadata.title || metadata['dc:title'];
  let bookTitle = opts.title;
  if (typeof rawTitle === 'string' && rawTitle.trim()) {
    bookTitle = rawTitle.trim();
  } else if (rawTitle && typeof rawTitle === 'object') {
    const t = rawTitle['#text'] || (Array.isArray(rawTitle) ? rawTitle[0]?.['#text'] || rawTitle[0] : '');
    if (typeof t === 'string' && t.trim()) bookTitle = t.trim();
  }

  const rawCreator = metadata.creator || metadata['dc:creator'];
  let bookAuthor: string | undefined;
  if (typeof rawCreator === 'string' && rawCreator.trim()) {
    bookAuthor = rawCreator.trim();
  } else if (rawCreator && typeof rawCreator === 'object') {
    const a = rawCreator['#text'] || (Array.isArray(rawCreator) ? rawCreator[0]?.['#text'] || rawCreator[0] : '');
    if (typeof a === 'string' && a.trim()) bookAuthor = a.trim();
  }

  // 5. Parse manifest
  const manifestItems = pkg.manifest?.item;
  const manifestList: any[] = Array.isArray(manifestItems)
    ? manifestItems
    : manifestItems
      ? [manifestItems]
      : [];

  const manifestById = new Map<string, { href: string; mediaType: string; properties?: string }>();
  for (const it of manifestList) {
    if (it?.['@_id'] && it?.['@_href']) {
      manifestById.set(it['@_id'], {
        href: it['@_href'],
        mediaType: it['@_media-type'] || '',
        properties: it['@_properties'] || '',
      });
    }
  }

  // 6. Find cover image
  let coverData: Uint8Array | undefined;
  let coverHref: string | undefined;

  // EPUB 3 cover-image property
  for (const [, item] of manifestById) {
    if (item.properties?.includes('cover-image')) {
      coverHref = item.href;
      break;
    }
  }

  // EPUB 2 meta name="cover"
  if (!coverHref) {
    for (const m of metaList) {
      if (m?.['@_name'] === 'cover' && m?.['@_content']) {
        const item = manifestById.get(m['@_content']);
        if (item) {
          coverHref = item.href;
          break;
        }
      }
    }
  }

  // Manifest item id="cover" or id="cover-image"
  if (!coverHref) {
    const candidate = manifestById.get('cover') || manifestById.get('cover-image');
    if (candidate && candidate.mediaType.startsWith('image/')) {
      coverHref = candidate.href;
    }
  }

  if (coverHref) {
    const resolvedCover = resolvePath(opfDir, coverHref);
    if (zip[resolvedCover]) {
      coverData = zip[resolvedCover];
    }
  }

  // 7. Parse Table of Contents
  const tocMap = new Map<string, string>(); // resolved spine href -> TOC title

  // Look for EPUB 3 nav document
  let navHref: string | undefined;
  for (const [, item] of manifestById) {
    if (item.properties?.includes('nav')) {
      navHref = item.href;
      break;
    }
  }

  if (navHref) {
    const navPath = resolvePath(opfDir, navHref);
    const navBytes = zip[navPath];
    if (navBytes) {
      const navHtml = fflate.strFromU8(navBytes);
      const navDir = navPath.includes('/') ? navPath.slice(0, navPath.lastIndexOf('/')) : '';
      const navParser = new htmlparser2.Parser({
        onopentag(name, attribs) {
          if (name.toLowerCase() === 'a' && attribs.href) {
            const targetResolved = resolvePath(navDir, attribs.href);
            // We'll capture title from child text in nav if simple
            // We can map targetResolved
            if (!tocMap.has(targetResolved)) {
              tocMap.set(targetResolved, '');
            }
          }
        },
      });
      navParser.write(navHtml);
      navParser.end();
    }
  }

  // Look for EPUB 2 NCX
  const spineTocId = pkg.spine?.['@_toc'];
  let ncxHref: string | undefined;
  if (spineTocId) {
    ncxHref = manifestById.get(spineTocId)?.href;
  }
  if (!ncxHref) {
    for (const [, item] of manifestById) {
      if (item.mediaType === 'application/x-dtbncx+xml') {
        ncxHref = item.href;
        break;
      }
    }
  }

  if (ncxHref) {
    const ncxPath = resolvePath(opfDir, ncxHref);
    const ncxBytes = zip[ncxPath];
    if (ncxBytes) {
      const ncxXml = fflate.strFromU8(ncxBytes);
      const ncxObj = xmlParser.parse(ncxXml);
      const ncxDir = ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/')) : '';
      const extractNavPoints = (points: any) => {
        if (!points) return;
        const list = Array.isArray(points) ? points : [points];
        for (const p of list) {
          const src = p?.content?.['@_src'];
          const label = p?.navLabel?.text;
          if (src && label && typeof label === 'string') {
            const target = resolvePath(ncxDir, src);
            if (!tocMap.has(target)) {
              tocMap.set(target, label.trim());
            }
          }
          if (p?.navPoint) {
            extractNavPoints(p.navPoint);
          }
        }
      };
      extractNavPoints(ncxObj?.ncx?.navMap?.navPoint);
    }
  }

  // 8. Spine items extraction
  const itemrefs = pkg.spine?.itemref;
  const spineList: any[] = Array.isArray(itemrefs) ? itemrefs : itemrefs ? [itemrefs] : [];

  const chapters: Chapter[] = [];
  let currentOffset = 0;
  let chapterIndex = 0;

  for (const itemref of spineList) {
    if (itemref?.['@_linear'] === 'no') continue;
    const idref = itemref?.['@_idref'];
    if (!idref) continue;

    const manifestItem = manifestById.get(idref);
    if (!manifestItem) continue;

    const itemPath = resolvePath(opfDir, manifestItem.href);
    const itemBytes = zip[itemPath];
    if (!itemBytes) continue;

    const html = fflate.strFromU8(itemBytes);
    const { text, firstHeading } = extractTextAndHeadingFromHtml(html);

    // Skip empty spine items (cover pages, blank spacers)
    if (!text.trim()) continue;

    const tocTitle = tocMap.get(itemPath);
    const title = tocTitle || firstHeading || `Section ${chapterIndex + 1}`;

    const charCount = text.length;
    chapters.push({
      index: chapterIndex,
      title,
      sourceHref: manifestItem.href,
      startOffset: currentOffset,
      charCount,
      text,
    });

    currentOffset += charCount;
    chapterIndex++;
  }

  if (chapters.length === 0) {
    throw new Error('No readable text chapters found in this EPUB.');
  }

  return {
    format: 'epub',
    title: bookTitle,
    author: bookAuthor,
    contentHash: opts.contentHash,
    sizeBytes: opts.sizeBytes,
    normalizationVersion: NORMALIZATION_VERSION,
    charCount: currentOffset,
    coverData,
    chapters,
  };
}
