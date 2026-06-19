#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const testRoot = path.join(root, 'out', 'test');

function collectTestFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

if (!fs.existsSync(testRoot)) {
  console.error(`Compiled test directory does not exist: ${testRoot}`);
  process.exit(1);
}

const testFiles = collectTestFiles(testRoot).sort();
if (testFiles.length === 0) {
  console.error(`No compiled test files found under: ${testRoot}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', '--test-timeout=10000', ...testFiles],
  {
    cwd: root,
    stdio: 'inherit',
    timeout: 30_000
  }
);

if (result.error) {
  if (result.error.code === 'ETIMEDOUT') {
    console.error('Test runner timed out after 30 seconds.');
    process.exit(1);
  }

  throw result.error;
}

if (result.signal) {
  console.error(`Test runner exited after signal: ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
