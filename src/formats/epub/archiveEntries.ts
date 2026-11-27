import { File, FileMode } from 'expo-file-system';
import { Unzip, UnzipInflate } from 'fflate';
import {
  ArchiveRejectedError,
  createArchiveGuard,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_SELECTED_ARCHIVE_BYTES,
} from './archiveSafety';

type EntryHandler = (data: Uint8Array) => Promise<void> | void;

/** Inflate selected entries, yielding for disk writes after each compressed input block. */
export async function scanEntries(source: string | Uint8Array, select: (name: string) => EntryHandler | undefined, done: () => boolean) {
  const pending: Promise<void>[] = [];
  const guard = createArchiveGuard();
  let selectedBytes = 0;
  const unzip = new Unzip((entry) => {
    const name = guard(entry.name, entry.originalSize);
    const consume = select(name);
    if (!consume) return;
    const pieces: Uint8Array[] = [];
    let length = 0;
    entry.ondata = (error, data, final) => {
      if (error) throw error;
      length += data.length;
      selectedBytes += data.length;
      if (length > MAX_ARCHIVE_ENTRY_BYTES || selectedBytes > MAX_SELECTED_ARCHIVE_BYTES) {
        throw new ArchiveRejectedError('extracted content exceeds the size limit.');
      }
      pieces.push(data);
      if (!final) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
      pending.push(Promise.resolve(consume(bytes)));
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const blockSize = 128 * 1024;
  if (typeof source !== 'string') {
    for (let i = 0; i < source.length && !done(); i += blockSize) {
      const end = Math.min(source.length, i + blockSize);
      unzip.push(source.subarray(i, end), end === source.length);
      await Promise.all(pending.splice(0));
    }
    return;
  }
  const file = new File(source);
  const size = file.info().size;
  const handle = file.open(FileMode.ReadOnly);
  try {
    let offset = 0;
    while (!done()) {
      const count = size == null ? blockSize : Math.min(blockSize, size - offset);
      const bytes = count > 0 ? await handle.readBytes(count) : new Uint8Array();
      offset += bytes.length;
      const final = !bytes.length || offset === size;
      unzip.push(bytes, final);
      await Promise.all(pending.splice(0));
      if (final) break;
    }
  } finally {
    handle.close();
  }
}
