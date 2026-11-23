import { File, FileMode } from 'expo-file-system';
import * as FS from 'expo-file-system/legacy';
import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import { extractChapterHtml } from './chapterHtml';
import { packagePath, resolvePath } from './importEpub';
import type { ChapterNavigation } from '../types';
import type { ChapterRow } from '@/db/repositories/chapters';

type EntryHandler = (data: Uint8Array) => Promise<void> | void;
const rebuilding = new Map<string, Promise<void>>();

function cachePath(dir: string, index: number) {
  return dir + '/' + String(index).padStart(4, '0') + '.links.json';
}

/** Stream older archives in bounded reads and inflate only requested XHTML entries. */
async function scanEntries(uri: string, select: (name: string) => EntryHandler | undefined, done: () => boolean) {
  const pending: Promise<void>[] = [];
  const unzip = new Unzip((entry) => {
    const consume = select(entry.name.replace(/^\.\//, '').replace(/^\//, ''));
    if (!consume) return;
    const pieces: Uint8Array[] = [];
    let length = 0;
    entry.ondata = (error, data, final) => {
      if (error) throw error;
      pieces.push(data);
      length += data.length;
      if (!final) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
      pending.push(Promise.resolve(consume(bytes)));
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const handle = new File(uri).open(FileMode.ReadOnly);
  try {
    while (!done()) {
      const bytes = await handle.readBytes(128 * 1024);
      unzip.push(bytes, bytes.length === 0);
      await Promise.all(pending.splice(0));
      if (!bytes.length) break;
    }
  } finally {
    handle.close();
  }
}

/** Footnotes and appendices may live outside the reading spine. */
export async function readSupplement(uri: string, path: string) {
  let result: ReturnType<typeof extractChapterHtml> | undefined;
  await scanEntries(uri, (name) => name === path
    ? (bytes) => { result = extractChapterHtml(strFromU8(bytes)); } : undefined, () => !!result);
  if (!result?.text) throw new Error('Linked section is unavailable');
  return result;
}

async function rebuild(uri: string, dir: string, rows: ChapterRow[]) {
  let opf: string | undefined;
  await scanEntries(uri, (name) => name === 'META-INF/container.xml'
    ? (bytes) => { opf = packagePath(bytes); } : undefined, () => !!opf);
  if (!opf) throw new Error('EPUB package could not be located');
  const packageDir = opf.slice(0, Math.max(0, opf.lastIndexOf('/')));
  const paths = new Map<string, ChapterRow[]>();
  for (const row of rows) {
    if (!row.source_href) continue;
    const path = resolvePath(packageDir, row.source_href);
    const same = paths.get(path) ?? [];
    same.push(row);
    paths.set(path, same);
  }
  await scanEntries(uri, (name) => {
    const matching = paths.get(name);
    if (!matching) return;
    return async (bytes) => {
      paths.delete(name);
      const { text, navigation } = extractChapterHtml(strFromU8(bytes));
      for (const row of matching) {
        const file = cachePath(dir, row.chapter_index);
        const stored = await FS.readAsStringAsync(file.replace('.links.json', '.txt'));
        if (text !== stored) continue;
        await FS.writeAsStringAsync(file + '.tmp', JSON.stringify({ ...navigation, packageDir }));
        await FS.moveAsync({ from: file + '.tmp', to: file });
      }
    };
  }, () => paths.size === 0);
}

export async function chapterNavigation(uri: string, dir: string, rows: ChapterRow[], index: number): Promise<ChapterNavigation> {
  const path = cachePath(dir, index);
  const read = async () => JSON.parse(await FS.readAsStringAsync(path)) as ChapterNavigation;
  try {
    return await read();
  } catch {
    let work = rebuilding.get(dir);
    if (!work) {
      work = rebuild(uri, dir, rows).finally(() => rebuilding.delete(dir));
      rebuilding.set(dir, work);
    }
    await work;
    return read();
  }
}
