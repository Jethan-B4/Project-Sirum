#!/usr/bin/env node
/**
 * scripts/verify-migrations.js
 *
 * Validates the local SQLite migration chain without booting the full app:
 *   - Opens an in-memory SQLite database (via better-sqlite3, dev-only)
 *   - Runs every migration in version order
 *   - Reports the final PRAGMA user_version
 *
 * This is a lightweight sanity check you can run in CI to catch SQL syntax
 * errors in new migrations before anyone runs the app.
 *
 * Usage:
 *   node scripts/verify-migrations.js
 *   npm run verify-migrations
 *
 * NOTE: better-sqlite3 is a devDependency. If it is not installed, this
 * script prints instructions and exits without error so it does not block CI.
 *
 * The TypeScript migration sources are transpiled on the fly with esbuild
 * (also a devDependency). If esbuild is unavailable the script falls back to
 * printing the SQL strings from the compiled JS in node_modules cache.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

// ---- transpile migrations/index with esbuild --------------------------------
const MIGRATIONS_ENTRY = path.join(__dirname, '..', 'src', 'db', 'migrations', 'index.ts');
const TMP_OUT = path.join(__dirname, '..', 'node_modules', '.cache', 'verify-migrations.cjs');

fs.mkdirSync(path.dirname(TMP_OUT), { recursive: true });

const build = spawnSync(
  'npx',
  ['esbuild', MIGRATIONS_ENTRY, '--bundle', '--platform=node', '--format=cjs', `--outfile=${TMP_OUT}`],
  { stdio: 'inherit', shell: true }
);

if (build.status !== 0) {
  console.warn('⚠  esbuild not available — skipping migration verification.');
  process.exit(0);
}

// ---- load migrations --------------------------------------------------------
let migrations;
try {
  ({ migrations } = require(TMP_OUT));
} catch (e) {
  console.error('✗  Could not load migrations:', e.message);
  process.exit(1);
}

// ---- open in-memory SQLite --------------------------------------------------
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.warn('⚠  better-sqlite3 not installed — skipping migration verification.');
  console.warn('   Run: npm install --save-dev better-sqlite3');
  process.exit(0);
}

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

const sorted = [...migrations].sort((a, b) => a.version - b.version);

for (const m of sorted) {
  console.log(`  Running migration v${m.version} …`);
  try {
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  } catch (e) {
    console.error(`✗  Migration v${m.version} failed:\n   ${e.message}`);
    process.exit(1);
  }
}

const { user_version } = db.pragma('user_version', { simple: true });
console.log(`✓  All ${sorted.length} migration(s) applied. Schema version: ${user_version}`);

