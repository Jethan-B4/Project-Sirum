import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const limit = 100_000_000;
const extensions = new Set(['.aab', '.apk', '.ipa']);
const files = process.argv.slice(2);

function collect(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (extensions.has(extname(path))) files.push(path);
  }
}

if (files[0] === '--eas') {
  if (process.env.EAS_BUILD_PROFILE !== 'production') process.exit(0);
  files.pop();
  if (process.env.EAS_BUILD_PLATFORM === 'android') {
    collect('android/app/build/outputs/bundle/release');
    collect('android/app/build/outputs/apk/release');
  } else {
    collect('ios/build');
    collect('build');
    files.push(...readdirSync('.').filter((name) => extname(name) === '.ipa'));
  }
}

if (!files.length) throw new Error('Provide the release AAB, APK or IPA to measure.');
for (const file of files) {
  const stat = statSync(file);
  if (!stat.isFile() || !extensions.has(extname(file).toLowerCase()) || !stat.size) {
    throw new Error('Expected a nonempty release package at ' + file);
  }
  console.log(file + ' weighs ' + stat.size.toLocaleString('en-US') + ' bytes.');
  if (stat.size > limit) throw new Error('Release package exceeds the 100 MB limit.');
}
