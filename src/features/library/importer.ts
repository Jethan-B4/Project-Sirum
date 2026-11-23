import * as Crypto from 'expo-crypto';
import { File, FileMode } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { getDb } from '@/db/client';
import type { DocumentRow } from '@/db/repositories/documents';
import { chapters, documents, importLog } from '@/db/repositories';
import { importEpub, readEpubCover } from '@/formats/epub/importEpub';
import { importTxt } from '@/formats/txt/importTxt';
import { NORMALIZATION_VERSION } from '@/text/normalize';
import { presentationFile, type Chapter } from '@/formats/types';
import type { DocumentFormat } from '@/lib/settingsKeys';

export interface PickedFile {
  uri: string;
  name: string;
  size?: number | null;
}

export type ImportResult =
  | { status: 'added'; title: string }
  | { status: 'duplicate'; title: string; documentId: string }
  | { status: 'unsupported'; title: string; reason: string }
  | { status: 'error'; title: string; reason: string };

const ACCEPTED: DocumentFormat[] = ['epub', 'txt', 'pdf'];

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Filename → display title (strip extension, replace _/- with space). */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const title = base.replace(/[_-]+/g, ' ').trim();
  return title.length > 0 ? title : name;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? chars[b2 & 63] : '=';
  }
  return out;
}

async function sha256Hex(uri: string): Promise<string> {
  // Preferred: the native File.digest streams the file without loading it.
  try {
    return await new File(uri).digest('SHA-256');
  } catch {
    /* fall through to the JS path */
  }
  try {
    const buf = await new File(uri).arrayBuffer();
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = base64ToBytes(b64);
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

async function cleanup(dir: string) {
  try {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {
    /* best effort */
  }
}

// --- Cover normalization (plan 5.2.1) -----------------------------------------

/** Detect the real image type from magic bytes; returns null for SVG/unknown. */
function sniffImageType(bytes: Uint8Array): 'jpeg' | 'png' | 'gif' | 'webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  )
    return 'png';
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return 'webp';
  return null;
}

/** PNG IHDR color type (byte 25) 4 or 6 means the image has an alpha channel. */
function pngHasAlpha(bytes: Uint8Array): boolean {
  return bytes.length > 25 && bytes[25] !== undefined && (bytes[25] === 4 || bytes[25] === 6);
}

const COVER_MAX_EDGE = 1200;

/**
 * Normalize a cover once at import: write the raw bytes to a temp file, decode
 * it (downscaling the long edge to <=1200px via the decoder), and re-encode as
 * JPEG — PNG when the source has an alpha channel. Returns the final cover URI
 * and pixel dimensions, or null when the bytes are not a usable raster image.
 */
async function normalizeCover(
  bytes: Uint8Array,
  bookDir: string
): Promise<{ uri: string; width: number; height: number } | null> {
  const type = sniffImageType(bytes);
  if (!type) return null; // SVG and unknown types fall back to the generated cover

  const srcExt = type === 'jpeg' ? 'jpg' : type;
  const srcUri = `${bookDir}/cover-src.${srcExt}`;
  await FileSystem.writeAsStringAsync(srcUri, uint8ArrayToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  try {
    const keepPng = type === 'png' && pngHasAlpha(bytes);
    // New contextual API (manipulateAsync is deprecated in SDK 58): decode with
    // a size cap so large covers never load at full resolution, then save.
    const context = ImageManipulator.manipulate(srcUri, {
      maxWidth: COVER_MAX_EDGE,
      maxHeight: COVER_MAX_EDGE,
    });
    const image = await context.renderAsync();
    if (!image.width || !image.height) return null;
    const result = await image.saveAsync({
      compress: 0.9,
      format: keepPng ? SaveFormat.PNG : SaveFormat.JPEG,
    });

    const ext = keepPng ? 'png' : 'jpg';
    const destUri = `${bookDir}/cover.${ext}`;
    try {
      await new File(result.uri).copy(new File(destUri), { overwrite: true });
    } catch {
      await FileSystem.copyAsync({ from: result.uri, to: destUri });
    }
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    return { uri: destUri, width: result.width, height: result.height };
  } catch {
    return null; // undecodable image — the generated cover is used instead
  } finally {
    await FileSystem.deleteAsync(srcUri, { idempotent: true }).catch(() => {});
  }
}

async function repairCover(existing: DocumentRow, originalUri: string, stagingDir: string) {
  if (!existing.local_uri) return;
  if (existing.cover_uri && existing.cover_width && existing.cover_height) {
    // Decode only the small existing cover. A healthy duplicate never opens the archive.
    try {
      const probe = ImageManipulator.manipulate(existing.cover_uri, { maxWidth: 1, maxHeight: 1 });
      try {
        const image = await probe.renderAsync();
        const readable = image.width > 0 && image.height > 0;
        image.release();
        if (readable) return;
      } finally {
        probe.release();
      }
    } catch { /* recover from the matching EPUB */ }
  }
  const parent = existing.local_uri.slice(0, existing.local_uri.lastIndexOf('/'));
  const noCover = parent + '/.no-embedded-cover';
  if (!existing.cover_uri && (await FileSystem.getInfoAsync(noCover)).exists) return;
  const bytes = await readEpubCover(originalUri);
  if (!bytes) {
    await FileSystem.writeAsStringAsync(noCover, '');
    return;
  }
  const cover = await normalizeCover(bytes, stagingDir);
  if (!cover) throw new Error('The original cover could not be decoded.');
  const ext = cover.uri.endsWith('.png') ? 'png' : 'jpg';
  const dest = parent + '/cover-' + Crypto.randomUUID() + '.' + ext;
  await FileSystem.moveAsync({ from: cover.uri, to: dest });
  try {
    await documents.updateLocalCover(existing.id, dest, cover.width, cover.height);
  } catch (error) {
    await cleanup(dest);
    throw error;
  }
  // Retire only artwork created in this book's own directory after the replacement commits.
  const old = existing.cover_uri;
  if (old?.startsWith(parent + '/') && /^cover(?:-[\da-f-]+)?\.(jpg|png)$/i.test(old.slice(parent.length + 1))) {
    await cleanup(old);
  }
}

/** Chunked copy fallback: stream the source through a FileHandle in 1 MB pieces. */
async function copyChunked(sourceUri: string, targetUri: string): Promise<void> {
  const src = new File(sourceUri);
  const dst = new File(targetUri);
  dst.create({ intermediates: true, overwrite: true });
  const inHandle = src.open(FileMode.ReadOnly);
  const outHandle = dst.open(FileMode.WriteOnly);
  try {
    const CHUNK = 1024 * 1024;
    for (;;) {
      const buf = await inHandle.readBytes(CHUNK);
      if (buf.length === 0) break;
      await outHandle.writeBytes(buf);
    }
  } finally {
    inHandle.close();
    outHandle.close();
  }
}

/**
 * Resiliently copy a picked file into the app sandbox.
 * The new File API's copy() handles Android content:// and SAF URIs natively;
 * legacy copyAsync/readAsStringAsync are kept only as last-resort fallbacks
 * because they reject some DocumentPicker cache files with "isn't readable".
 */
async function stageFile(sourceUri: string, targetUri: string): Promise<void> {
  // Strategy 1: new File API copy (native, content-URI aware)
  try {
    await new File(sourceUri).copy(new File(targetUri), { overwrite: true });
    return;
  } catch {
    /* try the next strategy */
  }

  // Strategy 2: chunked stream copy via FileHandle (bounded memory)
  try {
    await copyChunked(sourceUri, targetUri);
    return;
  } catch {
    /* try the legacy fallbacks */
  }

  // Strategy 3: native FileSystem.copyAsync (streams without memory balloon)
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
    return;
  } catch {
    /* try base64 fallbacks */
  }

  // Strategy 4: legacy base64 read/write
  try {
    const b64 = await FileSystem.readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(targetUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return;
  } catch (readErr) {
    // Strategy 4: StorageAccessFramework readAsStringAsync for Android SAF URIs
    if (Platform.OS === 'android' && FileSystem.StorageAccessFramework) {
      try {
        const b64 = await FileSystem.StorageAccessFramework.readAsStringAsync(sourceUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.writeAsStringAsync(targetUri, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return;
      } catch {
        // rethrow original readErr if SAF also failed
      }
    }
    throw readErr;
  }
}

/**
 * Import one picked file into the library. Every outcome is written to
 * `import_log` (plan 5.1.1) so scan/picker runs never fail silently.
 */
export async function importDocument(picked: PickedFile): Promise<ImportResult> {
  const result = await runImport(picked);
  const status =
    result.status === 'added'
      ? 'imported'
      : result.status === 'duplicate'
        ? 'duplicate'
        : result.status === 'unsupported'
          ? 'skipped'
          : 'failed';
  const reason =
    result.status === 'added' ? undefined : 'reason' in result ? result.reason : result.title;
  await importLog
    .add({ fileName: picked.name, sourceUri: picked.uri, status, reason })
    .catch(() => {});
  return result;
}

function chapterIndex(chapters: Chapter[]) {
  return chapters.map((chapter) => ({
    chapter_index: chapter.index,
    title: chapter.title,
    source_href: chapter.sourceHref ?? null,
    start_offset: chapter.startOffset,
    char_count: chapter.charCount,
  }));
}

async function runImport(picked: PickedFile): Promise<ImportResult> {
  const ext = extOf(picked.name);
  const title = titleFromFilename(picked.name);
  if (!ACCEPTED.includes(ext as DocumentFormat)) {
    return { status: 'unsupported', title: picked.name, reason: 'Unsupported file type' };
  }

  const format = ext as DocumentFormat;
  const documentId = Crypto.randomUUID();
  const bookDir = `${FileSystem.documentDirectory}books/${documentId}`;
  const chaptersDir = `${bookDir}/chapters`;
  const originalUri = `${bookDir}/original.${ext}`;

  let contentHash: string | undefined;
  try {
    const db = await getDb(); // Startup recovery finishes before staging begins.
    await FileSystem.makeDirectoryAsync(chaptersDir, { intermediates: true });

    // Stage the file safely into the sandbox
    await stageFile(picked.uri, originalUri);

    contentHash = await sha256Hex(originalUri);
    const existing = await documents.getByHash(contentHash);
    // Older releases wrote all chapter files, then committed the document and index separately.
    // Rebuild a missing index in place so external references to that document still work.
    if (existing && (existing.chapter_count === 0 || await chapters.hasIndex(existing.id))) {
      if (existing.format === 'epub') await repairCover(existing, originalUri, bookDir);
      await cleanup(bookDir);
      return { status: 'duplicate', title: existing.title, documentId: existing.id };
    }

    let book;
    if (format === 'txt') {
      book = await importTxt(originalUri, {
        title,
        contentHash,
        sizeBytes: picked.size ?? 0,
      });
    } else if (format === 'epub') {
      book = await importEpub(originalUri, {
        chaptersDir: existing ? undefined : chaptersDir,
        title,
        contentHash,
        sizeBytes: picked.size ?? 0,
      });
    } else {
      // PDF text extraction pipeline lands in later milestone
      await cleanup(bookDir);
      return {
        status: 'unsupported',
        title,
        reason: `${ext.toUpperCase()} text extraction is not available yet`,
      };
    }

    if (existing) {
      await chapters.replaceForDocument(existing.id, chapterIndex(book.chapters));
      if (existing.format === 'epub') await repairCover(existing, originalUri, bookDir);
      await cleanup(bookDir);
      return { status: 'duplicate', title: existing.title, documentId: existing.id };
    }

    // Persist extracted chapter text beside the original (rebuildable cache).
    for (const ch of book.chapters) {
      const padded = String(ch.index).padStart(4, '0');
      await FileSystem.writeAsStringAsync(`${chaptersDir}/${padded}.txt`, ch.text);
      if (ch.navigation) {
        await FileSystem.writeAsStringAsync(chaptersDir + '/' + presentationFile(ch.index), JSON.stringify(ch.navigation));
      }
    }

    // Normalize the cover once at import (plan 5.2.1): type-sniffed, resized,
    // re-encoded, with intrinsic dimensions stored on the document row.
    let coverUri: string | null = null;
    let coverWidth: number | null = null;
    let coverHeight: number | null = null;
    if (book.coverData && book.coverData.length > 0) {
      const cover = await normalizeCover(book.coverData, bookDir);
      if (cover) {
        coverUri = cover.uri;
        coverWidth = cover.width;
        coverHeight = cover.height;
      }
    }

    if (format === 'epub' && !book.coverData) {
      await FileSystem.writeAsStringAsync(bookDir + '/.no-embedded-cover', '');
    }
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await documents.create({
        id: documentId,
        format: book.format,
        title: book.title,
        author: book.author ?? null,
        local_uri: originalUri,
        text_dir: chaptersDir,
        cover_uri: coverUri,
        cover_width: coverWidth,
        cover_height: coverHeight,
        content_hash: book.contentHash,
        size_bytes: book.sizeBytes || null,
        encoding: book.encoding ?? null,
        normalization_version: book.normalizationVersion ?? NORMALIZATION_VERSION,
        chapter_count: book.chapters.length,
        char_count: book.charCount,
        storage_path: null,
        last_opened_at: null,
      }, transaction);
      await chapters.replaceForDocument(
        documentId,
        chapterIndex(book.chapters),
        transaction
      );
    });

    return { status: 'added', title: book.title };
  } catch (err) {
    await cleanup(bookDir);
    if (contentHash && /UNIQUE constraint failed: documents\.content_hash/i.test(String(err))) {
      const winner = await documents.getByHash(contentHash);
      if (winner) return { status: 'duplicate', title: winner.title, documentId: winner.id };
    }
    return {
      status: 'error',
      title,
      reason: err instanceof Error ? err.message : 'Import failed',
    };
  }
}
