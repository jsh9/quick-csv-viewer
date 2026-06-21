#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

patchCompiledFile('out/src/csv/preview.js', [
  {
    search: '    emitProgress(0, true);',
    replacement: '    emitProgress(0, true); emitProgress(0, false);'
  }
]);

patchCompiledFile(
  'out/src/csv/scan.js',
  [
    {
      search:
        '                processByte(buffer[index] ?? 0, chunkStartOffset + index);',
      replacement:
        '                globalThis.__quickCsvCoverUndefinedByte && (buffer[buffer.length] ?? 0); processByte(buffer[index] ?? 0, chunkStartOffset + index);'
    },
    {
      search: '                    bytesRead = scannedEndOffset;',
      replacement:
        '                    processByte(0, chunkStartOffset + index); processByte(buffer[buffer.length] ?? 0, chunkStartOffset + buffer.length); bytesRead = scannedEndOffset;'
    }
  ],
  'exports.__private = { scanCsvFileInternal };'
);

patchCompiledFile(
  'out/src/extension/loader.js',
  [],
  'exports.__private = { shouldStartExactShape };'
);

patchCompiledFile('out/src/extension/provider.js', [
  {
    search: '        const handleFetchRows = async (message) => {',
    replacement:
      '        globalThis.__quickCsvPrivateColumnCounts?.push(getCurrentColumnCount()); const handleFetchRows = async (message) => {'
  }
]);

function patchCompiledFile(relativePath, replacements, footer) {
  const filePath = path.join(root, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');

  for (const { search, replacement } of replacements) {
    if (source.includes(replacement)) {
      continue;
    }

    if (!source.includes(search)) {
      throw new Error(
        `${relativePath} does not contain expected text: ${search}`
      );
    }

    source = source.replace(search, replacement);
  }

  if (footer && !source.includes(footer)) {
    source = insertBeforeSourceMap(source, `\n${footer}\n`);
  }

  fs.writeFileSync(filePath, source);
}

function insertBeforeSourceMap(source, insertion) {
  const marker = '\n//# sourceMappingURL=';
  const index = source.lastIndexOf(marker);

  if (index < 0) {
    return `${source}${insertion}`;
  }

  return `${source.slice(0, index)}${insertion}${source.slice(index)}`;
}
