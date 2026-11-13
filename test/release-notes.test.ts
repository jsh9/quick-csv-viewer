import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const scriptPath = path.join(process.cwd(), 'scripts', 'release-notes.cjs');
const { extractReleaseNotes } = require(scriptPath) as {
  extractReleaseNotes(changelog: string, version: string): string;
};

const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes are documented here.',
  '',
  '## 0.0.5',
  '',
  '- Newest change.',
  '',
  '## 0.0.4',
  '',
  '- Add a feature.',
  '  Continued line.',
  '- Fix a bug.',
  '',
  '## 0.0.3',
  '',
  '- Oldest change.',
  ''
].join('\n');

function runScript(...args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8'
  });
}

test('release notes are the CHANGELOG section for one version', () => {
  assert.equal(
    extractReleaseNotes(CHANGELOG, '0.0.4'),
    '- Add a feature.\n  Continued line.\n- Fix a bug.\n'
  );
  assert.equal(extractReleaseNotes(CHANGELOG, '0.0.5'), '- Newest change.\n');
  // The last section runs to the end of the file.
  assert.equal(extractReleaseNotes(CHANGELOG, '0.0.3'), '- Oldest change.\n');
  assert.equal(
    extractReleaseNotes(CHANGELOG.replace(/\n/g, '\r\n'), '0.0.4'),
    '- Add a feature.\n  Continued line.\n- Fix a bug.\n'
  );
});

test('release notes reject a missing, partial, or empty version section', () => {
  assert.throws(
    () => extractReleaseNotes(CHANGELOG, '9.9.9'),
    /CHANGELOG\.md has no "## 9\.9\.9" section\./
  );
  // "## 0.0.4" must not match a heading such as "## 0.0.40".
  assert.throws(
    () => extractReleaseNotes('## 0.0.40\n\n- Other.\n', '0.0.4'),
    /no "## 0\.0\.4" section/
  );
  assert.throws(
    () => extractReleaseNotes('## 0.0.4\n\n## 0.0.3\n\n- Old.\n', '0.0.4'),
    /CHANGELOG\.md section "## 0\.0\.4" is empty\./
  );
});

test('release notes script prints the current version section of CHANGELOG.md', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  ) as { readonly version: string };
  const changelog = fs.readFileSync(
    path.join(process.cwd(), 'CHANGELOG.md'),
    'utf8'
  );

  const result = runScript(packageJson.version);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    extractReleaseNotes(changelog, packageJson.version)
  );
  assert.notEqual(result.stdout.trim(), '');
});

test('release notes script reports usage and missing sections', () => {
  const usage = runScript();
  assert.equal(usage.status, 2);
  assert.match(
    usage.stderr,
    /Usage: node scripts\/release-notes\.cjs <version>/
  );

  const missing = runScript('9.9.9');
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /no "## 9\.9\.9" section/);
});
