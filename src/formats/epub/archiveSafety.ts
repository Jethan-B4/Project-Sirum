export const MAX_ARCHIVE_COMPRESSED_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_SELECTED_ARCHIVE_BYTES = 256 * 1024 * 1024;

export class ArchiveRejectedError extends Error {
  constructor(message: string) {
    super(`EPUB archive rejected: ${message}`);
    this.name = 'ArchiveRejectedError';
  }
}

export function normalizeArchivePath(rawName: string): string {
  if (!rawName || rawName.includes('\0') || /^[\\/]/.test(rawName) || /^[a-z]:/i.test(rawName)) {
    throw new ArchiveRejectedError('an entry has an invalid or absolute path.');
  }

  const parts: string[] = [];
  for (const part of rawName.replace(/\\/g, '/').split('/')) {
    if (part === '..') throw new ArchiveRejectedError('an entry escapes the EPUB directory.');
    if (part && part !== '.') parts.push(part);
  }
  if (!parts.length) throw new ArchiveRejectedError('an entry has an empty path.');
  return parts.join('/');
}

export function createArchiveGuard() {
  const paths = new Set<string>();
  let totalBytes = 0;

  return (rawName: string, originalSize?: number): string => {
    const name = normalizeArchivePath(rawName);
    if (paths.has(name)) throw new ArchiveRejectedError(`duplicate entry "${name}".`);
    paths.add(name);

    if (originalSize !== undefined) {
      if (!Number.isSafeInteger(originalSize) || originalSize < 0 || originalSize > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new ArchiveRejectedError(`entry "${name}" exceeds the per-entry size limit.`);
      }
      totalBytes += originalSize;
      if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
        throw new ArchiveRejectedError('the archive exceeds the total uncompressed size limit.');
      }
    }

    return name;
  };
}

export function assertArchiveCompressedSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_COMPRESSED_BYTES) {
    throw new ArchiveRejectedError('the compressed file exceeds the size limit.');
  }
}

export function assertNoXmlDoctype(xml: string): void {
  if (/<!DOCTYPE\b/i.test(xml)) throw new ArchiveRejectedError('DOCTYPE declarations are not allowed.');
}
