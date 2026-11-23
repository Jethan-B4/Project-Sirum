import { scanEntries } from './archiveEntries';
import * as FS from 'expo-file-system/legacy';
import { strFromU8 } from 'fflate';
import { extractChapterHtml } from './chapterHtml';
import { cacheAsset, emptyAssets, isPublicationAsset, loadAssets, saveAssets } from './publicationAssets';
import type { PublicationAssets } from './publisherStyle';
import { packagePath, resolvePath } from './importEpub';
import { presentationFile, type ChapterNavigation } from '../types';
import type { ChapterRow } from '@/db/repositories/chapters';

const rebuilding = new Map<string, Promise<void>>();
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

async function rebuild(uri: string, dir: string, rows: ChapterRow[]) {
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
        ? { text: '', navigation: { presentationVersion: 2, links: [], anchors: [], images: [{ ...image, offset: 0, alt: '' }] } }
        : extractChapterHtml(strFromU8(bytes), name, assets);
      for (const row of matching) {
        const file = cachePath(dir, row.chapter_index);
        const stored = await FS.readAsStringAsync(file.replace('.presentation-v2.json', '.txt'));
        if (text !== stored) continue;
        if ((await FS.getInfoAsync(file)).exists) continue;
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
    try {
      await work;
      return await read();
    } catch {
      const old = path.replace('.presentation-v2.json', '.presentation.json');
      const cached = await FS.readAsStringAsync(old).catch(() => FS.readAsStringAsync(old.replace('.presentation.json', '.links.json')));
      return JSON.parse(cached) as ChapterNavigation;
    }
  }
}
