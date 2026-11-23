import { File } from 'expo-file-system';
import * as FS from 'expo-file-system/legacy';
import { strFromU8 } from 'fflate';
import type { PublicationAssets } from './publisherStyle';

export const isPublicationAsset = (name: string) => /\.(?:css|png|jpe?g|gif|webp|avif|svg)$/i.test(name);
export const emptyAssets = (): PublicationAssets => ({ css: new Map(), images: new Map() });

function imageAspect(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 24 && view.getUint32(0) === 0x89504e47) return view.getUint32(16) / view.getUint32(20);
  if (data.length >= 10 && data[0] === 71 && data[1] === 73 && data[2] === 70) {
    return view.getUint16(6, true) / view.getUint16(8, true);
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    for (let i = 2; i + 9 < data.length && data[i] === 0xff;) {
      const marker = data[i + 1], length = view.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return view.getUint16(i + 7) / view.getUint16(i + 5);
      if (length < 2 || marker === 0xda) break;
      i += length + 2;
    }
  }
}

export async function cacheAsset(assets: PublicationAssets, dir: string, name: string, data: Uint8Array) {
  if (/\.css$/i.test(name)) { assets.css.set(name, strFromU8(data)); return; }
  if (!isPublicationAsset(name) || assets.images.has(name)) return;
  const file = 'media-' + assets.images.size + '.' + name.split('.').pop()!.toLowerCase();
  const aspect = imageAspect(data);
  assets.images.set(name, { file, aspect: aspect && Number.isFinite(aspect) ? aspect : undefined });
  const target = new File(dir + '/' + file);
  target.create({ overwrite: true });
  await target.write(data);
}

export async function saveAssets(dir: string, assets: PublicationAssets) {
  const path = dir + '/publication-assets.json';
  await FS.writeAsStringAsync(path + '.tmp', JSON.stringify({ css: [...assets.css], images: [...assets.images] }));
  await FS.moveAsync({ from: path + '.tmp', to: path });
}

export async function loadAssets(dir: string): Promise<PublicationAssets> {
  const index = JSON.parse(await FS.readAsStringAsync(dir + '/publication-assets.json'));
  return { css: new Map(index.css), images: new Map(index.images) };
}
