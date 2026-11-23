import { XMLParser } from 'fast-xml-parser';
import * as fflate from 'fflate';
import { File, FileMode } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { scanEntries } from './archiveEntries';
import { extractChapterHtml } from './chapterHtml';
import { cacheAsset, emptyAssets, isPublicationAsset, saveAssets } from './publicationAssets';
import * as htmlparser2 from 'htmlparser2';

import { NORMALIZATION_VERSION } from '@/text/normalize';
import type { Chapter, ImportedBook } from '../types';

interface EpubOpts {
  chaptersDir?: string;
  title: string;
  contentHash: string;
  sizeBytes: number;
}

export function resolvePath(baseDir: string, relativePath: string): string {
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

async function readArchiveBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);

  // Strategy 1: Chunked stream read via FileHandle
  // Streams through bounded 2 MB buffers into Hermes native typed array,
  // preventing Android JVM from throwing OutOfMemoryError on large files (e.g. 50–150MB webnovels).
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      const size = file.info().size ?? 0;
      if (size > 0) {
        const out = new Uint8Array(size);
        let offset = 0;
        const CHUNK = 2 * 1024 * 1024;
        while (offset < size) {
          const chunk = await handle.readBytes(Math.min(CHUNK, size - offset));
          if (chunk.length === 0) break;
          out.set(chunk, offset);
          offset += chunk.length;
        }
        return out;
      }
    } finally {
      handle.close();
    }
  } catch {
    /* fallback to file.bytes() */
  }

  // Strategy 2: Direct file.bytes()
  try {
    return await file.bytes();
  } catch {
    /* fallback to file.arrayBuffer() */
  }

  // Strategy 3: Direct file.arrayBuffer()
  try {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    /* fallback to legacy Base64 */
  }

  // Strategy 4: Legacy readAsStringAsync (for small files in legacy environments)
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToUint8Array(b64);
}

const NON_TEXT_ASSETS = /\.(ttf|otf|woff|woff2|eot|mp3|mp4|wav|m4a|webm|avi|mkv)$/i;

function archivePath(rawKey: string) {
  return rawKey.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });

export function packagePath(containerBytes: Uint8Array): string {
  const containerXml = fflate.strFromU8(containerBytes);
  const containerObj = xmlParser.parse(containerXml);
  const rootfiles = containerObj?.container?.rootfiles?.rootfile;
  const rootfileList = Array.isArray(rootfiles) ? rootfiles : [rootfiles];
  const mainRootfile = rootfileList.find(
    (rf: any) => rf?.['@_media-type'] === 'application/oebps-package+xml' || rf?.['@_full-path']
  );
  return (mainRootfile?.['@_full-path'] || 'OEBPS/content.opf')
    .replace(/^\.\//, '')
    .replace(/^\//, '');
}

function packageInfo(entry: (name: string) => Uint8Array | undefined) {
  // 1. Check for DRM
  const encryptionBytes = entry('META-INF/encryption.xml');
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
  const containerBytes = entry('META-INF/container.xml');
  if (!containerBytes) {
    throw new Error('Invalid EPUB: META-INF/container.xml is missing.');
  }
  const opfPath = packagePath(containerBytes);
  const opfBytes = entry(opfPath);
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

  const coverPath = coverHref ? resolvePath(opfDir, coverHref) : undefined;
  const coverData = coverPath ? entry(coverPath) : undefined;
  return { xmlParser, opfDir, pkg, metadata, manifestById, coverData, coverPath };
}

/** Extract only the package metadata and named cover when repairing an existing book. */
export async function readEpubCover(uri: string) {
  const bytes = await readArchiveBytes(uri);
  const info = packageInfo((name) => {
    const entries = fflate.unzipSync(bytes, {
      filter: (entry) => archivePath(entry.name) === name,
    });
    return Object.values(entries)[0];
  });
  return info.coverData;
}

export async function importEpub(uri: string, opts: EpubOpts): Promise<ImportedBook> {
  // Read archive bytes using bounded, memory-efficient native reader
  const fileBytes = await readArchiveBytes(uri);

  // Unzip entries, skipping heavy embedded fonts and multimedia unused by the text reader
  let hasImages = false;
  let unzipped: fflate.Unzipped;
  try {
    unzipped = fflate.unzipSync(fileBytes, {
      filter(entry) {
        if (isPublicationAsset(entry.name) && !/\.css$/i.test(entry.name)) {
          hasImages = true;
          return false;
        }
        return !NON_TEXT_ASSETS.test(entry.name);
      },
    });
  } catch {
    throw new Error('Failed to unpack EPUB archive. The file may be damaged or not a valid ZIP.');
  }

  // Normalize path keys
  const zip: Record<string, Uint8Array> = {};
  for (const rawKey of Object.keys(unzipped)) {
    const key = archivePath(rawKey);
    zip[key] = unzipped[rawKey];
  }

  const { xmlParser, opfDir, pkg, metadata, manifestById, coverPath } = packageInfo((name) => zip[name]);
  const assets = emptyAssets();
  const dir = opts.chaptersDir;
  for (const name of Object.keys(zip)) {
    if (/\.css$/i.test(name)) assets.css.set(name, fflate.strFromU8(zip[name]));
  }
  let coverData = coverPath ? zip[coverPath] : undefined;
  if (hasImages && (dir || coverPath)) {
    await scanEntries(fileBytes, (name) => {
      if (name !== coverPath && (!dir || !isPublicationAsset(name) || /\.css$/i.test(name))) return;
      return async (bytes) => {
        if (name === coverPath) coverData = bytes;
        if (dir) await cacheAsset(assets, dir, name, bytes);
      };
    }, () => !dir && !!coverData);
  }
  if (dir) await saveAssets(dir, assets);

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
  let lastYield = Date.now();

  for (const itemref of spineList) {
    if (Date.now() - lastYield >= 12) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = Date.now();
    }
    if (itemref?.['@_linear'] === 'no') continue;
    const idref = itemref?.['@_idref'];
    if (!idref) continue;

    const manifestItem = manifestById.get(idref);
    if (!manifestItem) continue;

    const itemPath = resolvePath(opfDir, manifestItem.href);
    const itemBytes = zip[itemPath];
    const image = assets.images.get(itemPath);
    if (!itemBytes && !image) continue;

    const { text, firstHeading, navigation } = itemBytes
      ? extractChapterHtml(fflate.strFromU8(itemBytes), itemPath, assets)
      : { text: '', firstHeading: undefined, navigation: {
          presentationVersion: 2 as const, links: [], anchors: [], images: [{ ...image!, offset: 0, alt: '' }],
        } };

    // Keep illustrated chapters even when they have no canonical text.
    if (!text.trim() && !navigation.images?.length) continue;

    const tocTitle = tocMap.get(itemPath);
    const title = tocTitle || firstHeading || `Section ${chapterIndex + 1}`;

    const charCount = text.length;
    chapters.push({
      index: chapterIndex,
      title,
      sourceHref: manifestItem.href,
      navigation: { ...navigation, packageDir: opfDir },
      startOffset: currentOffset,
      charCount,
      text,
    });

    currentOffset += charCount;
    chapterIndex++;
  }

  if (chapters.length === 0) {
    throw new Error('No readable text or illustrations found in this EPUB.');
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
