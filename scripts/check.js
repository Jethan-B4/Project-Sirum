#!/usr/bin/env node
/**
 * scripts/check.js
 *
 * Runs the full pre-commit / CI quality gate in sequence:
 *   1. TypeScript type-check  (tsc --noEmit)
 *   2. Expo lint              (expo lint)
 *
 * Usage:
 *   node scripts/check.js
 *   npm run check           (via package.json "scripts")
 *
 * Exit code is non-zero if any step fails; output is streamed live.
 */

const { spawnSync } = require('child_process');

const steps = [
  { label: 'TypeScript', cmd: 'npx', args: ['tsc', '--noEmit'] },
  { label: 'Expo lint',  cmd: 'npx', args: ['expo', 'lint'] },
];

let failed = false;

for (const step of steps) {
  console.log(`\n▶  ${step.label} …`);
  const result = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`✗  ${step.label} failed (exit ${result.status})`);
    failed = true;
    break; // stop on first failure so errors are easy to read
  }
  console.log(`✓  ${step.label} passed`);
}

process.exit(failed ? 1 : 0);

