import { scanEntries } from './archiveEntries';
import * as FS from 'expo-file-system/legacy';
import { strFromU8 } from 'fflate';
import { extractChapterHtml } from './chapterHtml';
import { cacheAsset, emptyAssets, isPublicationAsset, loadAssets, saveAssets } from './publicationAssets';
import type { PublicationAssets } from './publisherStyle';
import { packagePath, resolvePath } from './importEpub';
import { chapterFileStem, PRESENTATION_VERSION, presentationFile, type ChapterNavigation } from '../types';
import type { ChapterRow } from '@/db/repositories/chapters';

type Rebuild = { done: Promise<void>; listeners: Set<(index: number) => void> };
const rebuilding = new Map<string, Rebuild>();
const preparingAssets = new Map<string, Promise<PublicationAssets>>();

function cachePath(dir: string, index: number) {
  return dir + '/' + presentationFile(index);
}

async function assetsFor(uri: string, dir: string) {
  let work = preparingAssets.get(dir);
  if (!work) {
    work = loadAssets(dir).catch(async () => {
      const assets = emptyAssets();
      await scanEntries(uri, (name) => isPublicationAsset(name)
        ? (bytes) => cacheAsset(assets, dir, name, bytes) : undefined, () => false);
      await saveAssets(dir, assets);
      return assets;
    }).finally(() => preparingAssets.delete(dir));
    preparingAssets.set(dir, work);
  }
  return work;
}

export async function readSupplement(uri: string, path: string, dir: string) {
  const assets = await assetsFor(uri, dir);
  let result: ReturnType<typeof extractChapterHtml> | undefined;
  await scanEntries(uri, (name) => name === path
    ? (bytes) => { result = extractChapterHtml(strFromU8(bytes), path, assets); } : undefined, () => !!result);
  if (!result || (!result.text && !result.navigation.images?.length)) throw new Error('Linked section is unavailable');
  return result;
}

async function rebuild(uri: string, dir: string, rows: ChapterRow[], published: (index: number) => void) {
  const assets = await assetsFor(uri, dir);
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
      const image = assets.images.get(name);
      const { text, navigation } = image
        ? { text: '', navigation: { presentationVersion: PRESENTATION_VERSION, links: [], anchors: [], images: [{ ...image, offset: 0, alt: '' }] } }
        : extractChapterHtml(strFromU8(bytes), name, assets);
      for (const row of matching) {
        const file = cachePath(dir, row.chapter_index);
        if ((await FS.getInfoAsync(file)).exists) continue;
        const stored = await FS.readAsStringAsync(dir + '/' + chapterFileStem(row.chapter_index) + '.txt');
        if (text !== stored) continue;
        await FS.writeAsStringAsync(file + '.tmp', JSON.stringify({ ...navigation, packageDir }));
        await FS.moveAsync({ from: file + '.tmp', to: file });
        published(row.chapter_index);
      }
    };
  }, () => paths.size === 0);
}

export async function chapterNavigation(uri: string, dir: string, rows: ChapterRow[], index: number): Promise<ChapterNavigation> {
  const path = cachePath(dir, index);
  const read = async (file = path) => JSON.parse(await FS.readAsStringAsync(file)) as ChapterNavigation;
  try {
    return await read();
  } catch {
    let work = rebuilding.get(dir);
    if (!work) {
      const listeners: Rebuild['listeners'] = new Set();
      const done = rebuild(uri, dir, rows, index => listeners.forEach(listener => listener(index)))
        .finally(() => rebuilding.delete(dir));
      work = { done, listeners };
      rebuilding.set(dir, work);
    }
    // Open this chapter as soon as its atomic write finishes. Other chapters can keep rebuilding.
    const { listeners, done } = work;
    let notify!: (publishedIndex: number) => void;
    const available = new Promise<void>(resolve => {
      notify = publishedIndex => { if (publishedIndex === index) resolve(); };
      listeners.add(notify);
    });
    try {
      await Promise.race([done, available]);
      return await read();
    } catch {
      const stem = dir + '/' + chapterFileStem(index);
      return read(stem + '.presentation-v3.json')
        .catch(() => read(stem + '.presentation-v2.json'))
        .catch(() => read(stem + '.presentation.json'))
        .catch(() => read(stem + '.links.json'));
    } finally {
      listeners.delete(notify);
    }
  }
}
