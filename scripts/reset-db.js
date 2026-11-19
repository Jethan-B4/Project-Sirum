#!/usr/bin/env node
/**
 * scripts/reset-db.js
 *
 * Clears the Expo SQLite database from the host-side simulator/emulator
 * cache so the app starts fresh on next launch (useful when testing
 * migrations during development).
 *
 * Works for the iOS Simulator on macOS and for Android emulators via adb.
 * On Windows, only the Android path is available.
 *
 * Usage:
 *   node scripts/reset-db.js            # auto-detects platform
 *   node scripts/reset-db.js android    # force Android
 *   node scripts/reset-db.js ios        # force iOS (macOS only)
 *
 * NOTE: This touches the simulator cache only. On a physical device,
 * clear app data through the OS settings or reinstall the app.
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const DB_NAME = 'reader.db';
const APP_BUNDLE = 'com.jethan44.sirum'; // must match app.json android.package

const platform = process.argv[2] ?? (os.platform() === 'darwin' ? 'ios' : 'android');

if (platform === 'android') {
  console.log(`Clearing ${DB_NAME} on Android emulator via adb …`);
  try {
    execSync(
      `adb shell run-as ${APP_BUNDLE} rm -f /data/data/${APP_BUNDLE}/databases/${DB_NAME}`,
      { stdio: 'inherit' }
    );
    console.log('✓  Database cleared. Restart the app.');
  } catch {
    console.error(
      '✗  adb command failed. Make sure an emulator is running and adb is on PATH.\n' +
      '   Alternatively, use "adb shell pm clear ' + APP_BUNDLE + '" to wipe all app data.'
    );
    process.exit(1);
  }
} else if (platform === 'ios') {
  if (os.platform() !== 'darwin') {
    console.error('✗  iOS Simulator is only available on macOS.');
    process.exit(1);
  }
  // Expo Go stores SQLite in the app container inside the Simulator data dir
  const simDataDir = path.join(
    os.homedir(),
    'Library/Developer/CoreSimulator/Devices'
  );
  const pattern = `find "${simDataDir}" -name "${DB_NAME}" 2>/dev/null`;
  const hits = execSync(pattern).toString().trim().split('\n').filter(Boolean);
  if (hits.length === 0) {
    console.log(`No ${DB_NAME} found in Simulator containers. The app may not have run yet.`);
  } else {
    for (const hit of hits) {
      fs.rmSync(hit, { force: true });
      console.log(`✓  Deleted: ${hit}`);
    }
    console.log('Restart the app.');
  }
} else {
  console.error(`Unknown platform "${platform}". Use "android" or "ios".`);
  process.exit(1);
}

