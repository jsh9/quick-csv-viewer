#!/usr/bin/env node

// Prints the CHANGELOG.md section for one version, for use as the notes of
// the GitHub release that .github/workflows/publish.yml creates.
// Usage: node scripts/release-notes.cjs <version>

const fs = require('node:fs');
const path = require('node:path');

function extractReleaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "## ${version}" section.`);
  }

  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith('## ')
  );
  const notes = lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join('\n')
    .trim();
  if (notes === '') {
    throw new Error(`CHANGELOG.md section "## ${version}" is empty.`);
  }

  return `${notes}\n`;
}

function main(argv, changelogPath) {
  const version = argv[2];
  if (!version) {
    process.stderr.write('Usage: node scripts/release-notes.cjs <version>\n');
    return 2;
  }

  try {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    process.stdout.write(extractReleaseNotes(changelog, version));
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(
    process.argv,
    path.join(__dirname, '..', 'CHANGELOG.md')
  );
}

module.exports = { extractReleaseNotes };
