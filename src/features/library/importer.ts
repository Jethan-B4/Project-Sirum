import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { chapters, documents } from '@/db/repositories';
import { importEpub } from '@/formats/epub/importEpub';
import { importTxt } from '@/formats/txt/importTxt';
import { NORMALIZATION_VERSION } from '@/text/normalize';
import type { DocumentFormat } from '@/lib/settingsKeys';

export interface PickedFile {
  uri: string;
  name: string;
  size?: number | null;
}

export type ImportResult =
  | { status: 'added'; title: string }
  | { status: 'duplicate'; title: string }
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

/**
 * Resiliently copy or stream a file into the app sandbox.
 * Handles Android content:// URIs, SAF document URIs, and standard file:// URIs,
 * providing graceful fallbacks if ExponentFileSystem.copyAsync throws java.io.IOException.
 */
async function stageFile(sourceUri: string, targetUri: string): Promise<void> {
  // Strategy 1: standard FileSystem.copyAsync
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
    return;
  } catch {
    // If copyAsync failed (e.g. java.io.IOException on Android content/SAF URIs), try fallbacks
  }

  // Strategy 2: readAsStringAsync as Base64 then writeAsStringAsync
  try {
    const b64 = await FileSystem.readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(targetUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return;
  } catch (readErr) {
    // Strategy 3: StorageAccessFramework readAsStringAsync for Android SAF URIs
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
 * Import one picked file into the library. Copies it into the app sandbox,
 * hashes it (SHA-256 of the file bytes), dedupes by hash, extracts text for
 * supported formats, and writes the document + chapter rows in one transaction.
 */
export async function importDocument(picked: PickedFile): Promise<ImportResult> {
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

  try {
    await FileSystem.makeDirectoryAsync(chaptersDir, { intermediates: true });

    // Stage the file safely into the sandbox
    await stageFile(picked.uri, originalUri);

    const contentHash = await sha256Hex(originalUri);
    const existing = await documents.getByHash(contentHash);
    if (existing) {
      await cleanup(bookDir);
      return { status: 'duplicate', title: existing.title };
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

    // Persist extracted chapter text beside the original (rebuildable cache).
    for (const ch of book.chapters) {
      const padded = String(ch.index).padStart(4, '0');
      await FileSystem.writeAsStringAsync(`${chaptersDir}/${padded}.txt`, ch.text);
    }

    // Save cover image if available
    let coverUri: string | null = null;
    if (book.coverData && book.coverData.length > 0) {
      coverUri = `${bookDir}/cover.jpg`;
      const coverB64 = uint8ArrayToBase64(book.coverData);
      try {
        await FileSystem.writeAsStringAsync(coverUri, coverB64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch {
        coverUri = null; // non-fatal if cover write fails
      }
    }

    // documents.create is an atomic INSERT
    await documents.create({
      id: documentId,
      format: book.format,
      title: book.title,
      author: book.author ?? null,
      local_uri: originalUri,
      text_dir: chaptersDir,
      cover_uri: coverUri,
      content_hash: book.contentHash,
      size_bytes: book.sizeBytes || null,
      encoding: book.encoding ?? null,
      normalization_version: book.normalizationVersion ?? NORMALIZATION_VERSION,
      chapter_count: book.chapters.length,
      char_count: book.charCount,
      storage_path: null,
      last_opened_at: null,
    });

    try {
      await chapters.replaceForDocument(
        documentId,
        book.chapters.map((c) => ({
          chapter_index: c.index,
          title: c.title,
          source_href: c.sourceHref ?? null,
          start_offset: c.startOffset,
          char_count: c.charCount,
        }))
      );
    } catch (err) {
      await documents.softDelete(documentId).catch(() => {});
      throw err;
    }

    return { status: 'added', title: book.title };
  } catch (err) {
    await cleanup(bookDir);
    return {
      status: 'error',
      title,
      reason: err instanceof Error ? err.message : 'Import failed',
    };
  }
}
