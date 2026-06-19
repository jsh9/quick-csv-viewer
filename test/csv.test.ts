import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import {
  CsvOperationCancelledError,
  DEFAULT_FIRST_ROW_IS_HEADER,
  DEFAULT_MAX_ROWS,
  DEFAULT_WRAP_CELL_CONTENTS,
  INDEXED_PREVIEW_ROW_THRESHOLD,
  fetchCsvRecordRange,
  fetchCsvHeaders,
  fetchCsvRows,
  formatFileSize,
  getDataRowCount,
  getDisplayRowCount,
  getRecordLimit,
  indexCsvFile,
  isAbortError,
  normalizeHeaders,
  normalizeViewerSettings,
  parseCsvRecordsFromText,
  readCsvPreview,
  scanCsvShape,
  shouldUseIndexedPreview
} from '../src/csv';

let tempDir = '';

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-csv-viewer-'));
});

after(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('default limit reads the first 20 data rows with a header', async () => {
  const filePath = await writeFixture(
    'default-limit.csv',
    [
      'id,value',
      ...Array.from({ length: 25 }, (_, index) => `${index},v${index}`)
    ].join('\n')
  );

  const settings = normalizeViewerSettings({});
  const preview = await readCsvPreview(filePath, settings);

  assert.equal(settings.maxRows, DEFAULT_MAX_ROWS);
  assert.equal(settings.firstRowIsHeader, DEFAULT_FIRST_ROW_IS_HEADER);
  assert.equal(settings.wrapCellContents, DEFAULT_WRAP_CELL_CONTENTS);
  assert.deepEqual(preview.headers, ['id', 'value']);
  assert.equal(preview.loadedRowCount, 20);
  assert.equal(preview.rows.length, 20);
  assert.equal(preview.rows[0]?.rowNumber, 1);
  assert.deepEqual(preview.rows[0]?.cells, ['0', 'v0']);
  assert.deepEqual(preview.rows[19]?.cells, ['19', 'v19']);
  assert.equal(
    preview.rows.some((row) => row.cells[0] === '20'),
    false
  );
});

test('maxRows set to 0 can load all rows through the preview helper', async () => {
  const filePath = await writeFixture(
    'all-rows.csv',
    [
      'id,value',
      ...Array.from({ length: 25 }, (_, index) => `${index},v${index}`)
    ].join('\n')
  );

  const progress: Array<{ loadedRowCount: number; percent: number }> = [];
  const preview = await readCsvPreview(
    filePath,
    {
      maxRows: 0,
      firstRowIsHeader: true
    },
    {
      onProgress: (event) => progress.push(event)
    }
  );

  assert.equal(preview.loadedRowCount, 25);
  assert.equal(preview.rows.length, 25);
  assert.deepEqual(preview.rows[24]?.cells, ['24', 'v24']);
  assert.equal(progress.at(-1)?.loadedRowCount, 25);
  assert.equal(progress.at(-1)?.percent, 0);
});

test('header setting controls whether the first record is a data row', async () => {
  const filePath = await writeFixture('header-off.csv', 'id,value\n1,a\n2,b');

  const withHeader = await readCsvPreview(filePath, {
    maxRows: 2,
    firstRowIsHeader: true
  });
  assert.deepEqual(withHeader.headerFields, ['id', 'value']);
  assert.equal(withHeader.rows[0]?.rowNumber, 1);
  assert.deepEqual(withHeader.rows[0]?.cells, ['1', 'a']);

  const withoutHeader = await readCsvPreview(filePath, {
    maxRows: 2,
    firstRowIsHeader: false
  });
  assert.deepEqual(withoutHeader.headerFields, []);
  assert.equal(withoutHeader.rows[0]?.rowNumber, 1);
  assert.deepEqual(withoutHeader.rows[0]?.cells, ['id', 'value']);
});

test('preview reading reports progress for limited loads', async () => {
  const filePath = await writeFixture('preview-progress.csv', 'a\n1\n2\n3\n4');
  const progress: Array<{
    loadedRowCount: number;
    displayLimit: number;
    percent: number;
  }> = [];

  const preview = await readCsvPreview(
    filePath,
    { maxRows: 3, firstRowIsHeader: true },
    {
      progressIntervalMs: 0,
      onProgress: (event) => progress.push(event)
    }
  );

  assert.equal(preview.loadedRowCount, 3);
  assert.ok(progress.length >= 2);
  assert.equal(progress[0]?.loadedRowCount, 0);
  assert.equal(progress.at(-1)?.loadedRowCount, 3);
  assert.equal(progress.at(-1)?.displayLimit, 3);
  assert.equal(progress.at(-1)?.percent, 100);
});

test('preview reading can be cancelled before file work starts', async () => {
  const filePath = await writeFixture('cancel-preview.csv', 'a\n1');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    readCsvPreview(
      filePath,
      { maxRows: 1, firstRowIsHeader: true },
      { signal: controller.signal }
    ),
    (error: unknown) => isAbortError(error)
  );
});

test('CSV parsing handles quoted commas, escaped quotes, and embedded newlines', () => {
  assert.deepEqual(
    parseCsvRecordsFromText(
      'name,note\n"A, B","He said ""hi""\nagain"\r\nplain,last'
    ),
    [
      ['name', 'note'],
      ['A, B', 'He said "hi"\nagain'],
      ['plain', 'last']
    ]
  );
});

test('CSV parsing handles CRLF, LF, CR, blank records, and trailing newlines', () => {
  assert.deepEqual(parseCsvRecordsFromText('a,b\r\n1,2\n3,4\r5,6\n'), [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
    ['5', '6']
  ]);
  assert.deepEqual(parseCsvRecordsFromText('\n'), [['']]);
  assert.deepEqual(parseCsvRecordsFromText(''), []);
});

test('CSV parsing handles final carriage returns and unterminated quoted fields', () => {
  assert.deepEqual(parseCsvRecordsFromText('a,b\r'), [['a', 'b']]);
  assert.deepEqual(parseCsvRecordsFromText('"unterminated\nfield'), [
    ['unterminated\nfield']
  ]);
  assert.deepEqual(parseCsvRecordsFromText('"quoted"x,next'), [
    ['quotedx', 'next']
  ]);
});

test('shape scan counts data rows based on header setting and tracks ragged columns', async () => {
  const filePath = await writeFixture('shape.csv', 'a,b\n1\n2,3,4');

  assert.deepEqual(await scanCsvShape(filePath, { firstRowIsHeader: true }), {
    rowCount: 2,
    columnCount: 3,
    recordCount: 3
  });
  assert.deepEqual(await scanCsvShape(filePath, { firstRowIsHeader: false }), {
    rowCount: 3,
    columnCount: 3,
    recordCount: 3
  });
});

test('CSV shape and indexing handle CR-only line endings and escaped quotes', async () => {
  const filePath = await writeFixture(
    'cr-and-quotes.csv',
    'name,note\r"Alice","hi ""there"""\rBob,last\r'
  );
  const index = await indexCsvFile(filePath, { chunkSize: 5 });

  assert.equal(index.indexedRecordCount, 3);
  assert.equal(index.isComplete, true);
  assert.equal(index.maxColumnCount, 2);
  assert.deepEqual(await scanCsvShape(filePath, { firstRowIsHeader: true }), {
    rowCount: 2,
    columnCount: 2,
    recordCount: 3
  });

  const rows = await fetchCsvRows(filePath, index, {
    start: 0,
    count: 2,
    firstRowIsHeader: true,
    columnCount: 2
  });
  assert.deepEqual(
    rows.rows.map((row) => row.cells),
    [
      ['Alice', 'hi "there"'],
      ['Bob', 'last']
    ]
  );
});

test('CSV indexing handles CRLF records across chunk boundaries', async () => {
  const filePath = await writeFixture('crlf-scan.csv', 'a,b\r\n1,2\r\n3,4');
  const index = await indexCsvFile(filePath, { chunkSize: 4 });

  assert.equal(index.indexedRecordCount, 3);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.recordOffsets, [0, 5, 10]);
  assert.deepEqual(await scanCsvShape(filePath, { firstRowIsHeader: true }), {
    rowCount: 2,
    columnCount: 2,
    recordCount: 3
  });
});

test('empty files have a 0 x 0 shape and no preview rows', async () => {
  const filePath = await writeFixture('empty.csv', '');
  const shapeProgress: Array<{
    percent: number;
    recordCount: number;
    rowCount: number;
    columnCount: number;
  }> = [];
  const indexProgress: Array<{
    percent: number;
    indexedRecordCount: number;
    columnCount: number;
  }> = [];

  assert.deepEqual(
    await scanCsvShape(filePath, {
      firstRowIsHeader: true,
      onProgress: (event) => shapeProgress.push(event)
    }),
    {
      rowCount: 0,
      columnCount: 0,
      recordCount: 0
    }
  );
  assert.equal(shapeProgress.at(-1)?.percent, 100);
  assert.equal(shapeProgress.at(-1)?.recordCount, 0);
  assert.equal(shapeProgress.at(-1)?.rowCount, 0);
  assert.equal(shapeProgress.at(-1)?.columnCount, 0);

  const index = await indexCsvFile(filePath, {
    onProgress: (event) => indexProgress.push(event)
  });
  assert.equal(index.indexedRecordCount, 0);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.recordOffsets, []);
  assert.equal(indexProgress.at(-1)?.percent, 100);
  assert.equal(indexProgress.at(-1)?.indexedRecordCount, 0);
  assert.equal(indexProgress.at(-1)?.columnCount, 0);

  const preview = await readCsvPreview(filePath, {
    maxRows: 20,
    firstRowIsHeader: true
  });
  assert.equal(preview.columnCount, 0);
  assert.deepEqual(preview.headers, []);
  assert.deepEqual(preview.rows, []);
});

test('normalizes generated column names for missing or blank headers', () => {
  assert.deepEqual(normalizeHeaders(['id', '', 'value'], 5), [
    'id',
    'Column 2',
    'value',
    'Column 4',
    'Column 5'
  ]);
});

test('file sizes are formatted across byte units and invalid inputs', () => {
  assert.equal(formatFileSize(-1), '0 B');
  assert.equal(formatFileSize(Number.NaN), '0 B');
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(1023), '1023 B');
  assert.equal(formatFileSize(1024), '1.00 KB');
  assert.equal(formatFileSize(10 * 1024), '10.0 KB');
  assert.equal(formatFileSize(1024 ** 2), '1.00 MB');
  assert.equal(formatFileSize(1024 ** 4), '1.00 TB');
  assert.equal(formatFileSize(1024 ** 5), '1024.0 TB');
});

test('full-file indexing handles record offsets and quoted newlines', async () => {
  const filePath = await writeFixture(
    'quoted-newline.csv',
    'name,note\n"one\ntwo",x\nlast,row'
  );
  const index = await indexCsvFile(filePath, { chunkSize: 3 });

  assert.equal(index.indexedRecordCount, 3);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.equal(index.maxColumnCount, 2);
  assert.deepEqual(index.recordOffsets, [0, 10, 22]);

  const rows = await fetchCsvRows(filePath, index, {
    start: 0,
    count: 2,
    firstRowIsHeader: true,
    columnCount: 2
  });
  assert.equal(rows.indexedDataRowCount, 2);
  assert.deepEqual(rows.rows[0]?.cells, ['one\ntwo', 'x']);
  assert.deepEqual(rows.rows[1]?.cells, ['last', 'row']);
});

test('record range fetching handles headers, clamping, and malformed offsets', async () => {
  const filePath = await writeFixture('record-ranges.csv', 'a,b\n1,2\n3,4');
  const index = await indexCsvFile(filePath);

  assert.deepEqual(
    await fetchCsvHeaders(filePath, index, {
      firstRowIsHeader: true,
      columnCount: 3
    }),
    {
      headerFields: ['a', 'b'],
      headers: ['a', 'b', 'Column 3']
    }
  );
  assert.deepEqual(
    await fetchCsvHeaders(filePath, index, {
      firstRowIsHeader: false,
      columnCount: 2
    }),
    {
      headerFields: [],
      headers: ['Column 1', 'Column 2']
    }
  );
  assert.deepEqual(await fetchCsvRecordRange(filePath, index, -2, 2), [
    ['a', 'b'],
    ['1', '2']
  ]);
  assert.deepEqual(await fetchCsvRecordRange(filePath, index, 1.8, 1.2), [
    ['1', '2']
  ]);
  assert.deepEqual(
    await fetchCsvRecordRange(
      filePath,
      index,
      Number.NaN,
      Number.POSITIVE_INFINITY
    ),
    []
  );

  const missingOffsetIndex = {
    ...index,
    recordOffsets: []
  };
  assert.deepEqual(
    await fetchCsvRecordRange(filePath, missingOffsetIndex, 0, 1),
    []
  );
  assert.deepEqual(
    await fetchCsvHeaders(filePath, missingOffsetIndex, {
      firstRowIsHeader: true,
      columnCount: 2
    }),
    {
      headerFields: [],
      headers: ['Column 1', 'Column 2']
    }
  );

  const reversedOffsetIndex = {
    ...index,
    recordOffsets: [4],
    indexedEndOffset: 2
  };
  assert.deepEqual(
    await fetchCsvRecordRange(filePath, reversedOffsetIndex, 0, 1),
    []
  );
});

test('prefix indexing stops after the requested preview records', async () => {
  const filePath = await writeFixture(
    'prefix-limit.csv',
    'id,value\n1,a\n2,b\n3,c'
  );
  const index = await indexCsvFile(filePath, { chunkSize: 64, recordLimit: 3 });

  assert.equal(index.indexedRecordCount, 3);
  assert.equal(index.isComplete, false);
  assert.deepEqual(index.recordOffsets, [0, 9, 13]);

  const rows = await fetchCsvRows(filePath, index, {
    start: 0,
    count: 2,
    firstRowIsHeader: true,
    columnCount: 2
  });
  assert.deepEqual(
    rows.rows.map((row) => row.cells),
    [
      ['1', 'a'],
      ['2', 'b']
    ]
  );
});

test('record limit zero indexes no records without reading rows', async () => {
  const filePath = await writeFixture('zero-record-limit.csv', 'a\n1\n2');
  const progress: Array<{ indexedRecordCount: number; percent: number }> = [];
  const index = await indexCsvFile(filePath, {
    recordLimit: 0,
    progressIntervalMs: 0,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(index.indexedRecordCount, 0);
  assert.equal(index.indexedEndOffset, 0);
  assert.equal(index.isComplete, false);
  assert.equal(index.maxColumnCount, 0);
  assert.deepEqual(index.recordOffsets, []);
  assert.equal(progress.at(-1)?.indexedRecordCount, 0);
  assert.equal(progress.at(-1)?.percent, 0);
});

test('record limits stop after CR-only records without consuming the next record', async () => {
  const filePath = await writeFixture('cr-record-limit.csv', 'a\rb\rc');
  const index = await indexCsvFile(filePath, {
    chunkSize: 16,
    recordLimit: 1
  });

  assert.equal(index.indexedRecordCount, 1);
  assert.equal(index.indexedEndOffset, 2);
  assert.equal(index.isComplete, false);
  assert.deepEqual(index.recordOffsets, [0]);
  assert.deepEqual(await fetchCsvRecordRange(filePath, index, 0, 1), [['a']]);
});

test('prefix indexing is complete when the limit exceeds file length', async () => {
  const filePath = await writeFixture('prefix-complete.csv', 'id\n1\n2');
  const index = await indexCsvFile(filePath, { chunkSize: 2, recordLimit: 10 });

  assert.equal(index.indexedRecordCount, 3);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.recordOffsets, [0, 3, 5]);
});

test('trailing newline does not add a phantom record', async () => {
  const filePath = await writeFixture('trailing-newline.csv', 'a,b\n1,2\n');
  const index = await indexCsvFile(filePath, { chunkSize: 2 });

  assert.equal(index.indexedRecordCount, 2);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.recordOffsets, [0, 4]);
});

test('range fetching clamps out-of-range requests', async () => {
  const filePath = await writeFixture('range-clamp.csv', 'a\n1\n2');
  const index = await indexCsvFile(filePath);
  const rows = await fetchCsvRows(filePath, index, {
    start: 10,
    count: 10,
    firstRowIsHeader: true,
    columnCount: 1
  });

  assert.equal(rows.start, 2);
  assert.deepEqual(rows.rows, []);
  assert.equal(rows.indexedDataRowCount, 2);
});

test('row fetching clamps negative, fractional, and non-finite ranges', async () => {
  const filePath = await writeFixture('row-range-values.csv', 'a,b\n1,2\n3');
  const index = await indexCsvFile(filePath);

  const negative = await fetchCsvRows(filePath, index, {
    start: -5,
    count: 1.9,
    firstRowIsHeader: true,
    columnCount: 3
  });
  assert.equal(negative.start, 0);
  assert.deepEqual(negative.rows, [
    {
      rowNumber: 1,
      cells: ['1', '2', '']
    }
  ]);

  const nonFinite = await fetchCsvRows(filePath, index, {
    start: Number.NaN,
    count: Number.POSITIVE_INFINITY,
    firstRowIsHeader: true,
    columnCount: 2
  });
  assert.equal(nonFinite.start, 0);
  assert.deepEqual(nonFinite.rows, []);
});

test('shape scanning reports byte and shape progress', async () => {
  const contents = 'a,b\n1,2\n3,4';
  const filePath = await writeFixture('shape-progress.csv', contents);
  const progress: Array<{
    bytesRead: number;
    totalBytes: number;
    percent: number;
    recordCount: number;
    rowCount: number;
    columnCount: number;
  }> = [];

  const shape = await scanCsvShape(filePath, {
    firstRowIsHeader: true,
    chunkSize: 3,
    progressIntervalMs: 0,
    onProgress: (event) => progress.push(event)
  });

  assert.deepEqual(shape, {
    rowCount: 2,
    columnCount: 2,
    recordCount: 3
  });
  assert.ok(progress.length >= 2);
  assert.equal(progress[0]?.bytesRead, 0);
  assert.equal(progress[0]?.totalBytes, Buffer.byteLength(contents));
  assert.equal(progress.at(-1)?.bytesRead, Buffer.byteLength(contents));
  assert.equal(progress.at(-1)?.percent, 100);
  assert.equal(progress.at(-1)?.rowCount, 2);
  assert.equal(progress.at(-1)?.columnCount, 2);
});

test('full-file indexing reports progress', async () => {
  const filePath = await writeFixture('index-progress.csv', 'a\n1\n2');
  const progress: Array<{
    bytesRead: number;
    totalBytes: number;
    percent: number;
    indexedRecordCount: number;
    columnCount: number;
  }> = [];
  const index = await indexCsvFile(filePath, {
    chunkSize: 2,
    progressIntervalMs: 0,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(index.indexedRecordCount, 3);
  assert.ok(progress.length >= 2);
  assert.equal(progress[0]?.bytesRead, 0);
  assert.equal(progress.at(-1)?.bytesRead, index.fileSize);
  assert.equal(progress.at(-1)?.percent, 100);
  assert.equal(progress.at(-1)?.indexedRecordCount, 3);
});

test('indexing and shape scanning can be cancelled', async () => {
  const filePath = await writeFixture(
    'cancel.csv',
    ['a', ...Array.from({ length: 100 }, (_, index) => String(index))].join(
      '\n'
    )
  );
  const indexController = new AbortController();
  const shapeController = new AbortController();

  await assert.rejects(
    indexCsvFile(filePath, {
      chunkSize: 4,
      progressIntervalMs: 0,
      signal: indexController.signal,
      onProgress: (event) => {
        if (event.bytesRead > 0) {
          indexController.abort();
        }
      }
    }),
    (error: unknown) => isAbortError(error)
  );

  shapeController.abort();
  await assert.rejects(
    scanCsvShape(filePath, {
      firstRowIsHeader: true,
      signal: shapeController.signal
    }),
    (error: unknown) => isAbortError(error)
  );
});

test('missing files reject from preview, index, shape, and row fetch paths', async () => {
  const missingPath = path.join(tempDir, 'missing.csv');
  const index = {
    fileSize: 1,
    recordOffsets: [0],
    indexedRecordCount: 1,
    indexedEndOffset: 1,
    isComplete: true,
    maxColumnCount: 1
  };

  await assert.rejects(
    readCsvPreview(missingPath, { maxRows: 1, firstRowIsHeader: true }),
    /ENOENT/
  );
  await assert.rejects(indexCsvFile(missingPath), /ENOENT/);
  await assert.rejects(
    scanCsvShape(missingPath, { firstRowIsHeader: true }),
    /ENOENT/
  );
  await assert.rejects(fetchCsvRecordRange(missingPath, index, 0, 1), /ENOENT/);
});

test('progress callbacks can be omitted or throttled while final events are forced', async () => {
  const filePath = await writeFixture(
    'throttled-progress.csv',
    'a,b\n1,2\n3,4'
  );
  const previewProgress: Array<{ loadedRowCount: number; percent: number }> =
    [];
  const shapeProgress: Array<{ bytesRead: number; percent: number }> = [];
  const indexProgress: Array<{ bytesRead: number; percent: number }> = [];

  await readCsvPreview(filePath, { maxRows: 2, firstRowIsHeader: true });
  await scanCsvShape(filePath, { firstRowIsHeader: true });
  await indexCsvFile(filePath);

  await readCsvPreview(
    filePath,
    { maxRows: 2, firstRowIsHeader: true },
    {
      progressIntervalMs: 60_000,
      onProgress: (event) => previewProgress.push(event)
    }
  );
  await scanCsvShape(filePath, {
    firstRowIsHeader: true,
    chunkSize: 2,
    progressIntervalMs: 60_000,
    onProgress: (event) => shapeProgress.push(event)
  });
  await indexCsvFile(filePath, {
    chunkSize: 2,
    progressIntervalMs: 60_000,
    onProgress: (event) => indexProgress.push(event)
  });

  assert.deepEqual(
    previewProgress.map((event) => event.loadedRowCount),
    [0, 2]
  );
  assert.equal(previewProgress.at(-1)?.percent, 100);
  assert.equal(shapeProgress[0]?.bytesRead, 0);
  assert.equal(shapeProgress.at(-1)?.percent, 100);
  assert.equal(indexProgress[0]?.bytesRead, 0);
  assert.equal(indexProgress.at(-1)?.percent, 100);
});

test('settings validation and row-count helpers follow viewer semantics', () => {
  assert.deepEqual(
    normalizeViewerSettings({
      maxRows: -1,
      firstRowIsHeader: 'yes',
      wrapCellContents: 'yes'
    }),
    {
      maxRows: DEFAULT_MAX_ROWS,
      firstRowIsHeader: DEFAULT_FIRST_ROW_IS_HEADER,
      wrapCellContents: DEFAULT_WRAP_CELL_CONTENTS
    }
  );
  assert.deepEqual(
    normalizeViewerSettings({
      maxRows: 0,
      firstRowIsHeader: false,
      wrapCellContents: false
    }),
    {
      maxRows: 0,
      firstRowIsHeader: false,
      wrapCellContents: false
    }
  );

  assert.equal(getRecordLimit({ maxRows: 20, firstRowIsHeader: true }), 21);
  assert.equal(getRecordLimit({ maxRows: 20, firstRowIsHeader: false }), 20);
  assert.equal(
    getRecordLimit({ maxRows: 0, firstRowIsHeader: true }),
    undefined
  );
  assert.equal(getDataRowCount(3, true), 2);
  assert.equal(getDataRowCount(3, false), 3);
  assert.equal(getDisplayRowCount(200_000, 0), 200_000);
  assert.equal(getDisplayRowCount(200_000, 1_000), 1_000);
  assert.equal(shouldUseIndexedPreview(0), true);
  assert.equal(shouldUseIndexedPreview(DEFAULT_MAX_ROWS), false);
  assert.equal(
    shouldUseIndexedPreview(INDEXED_PREVIEW_ROW_THRESHOLD - 1),
    false
  );
  assert.equal(shouldUseIndexedPreview(INDEXED_PREVIEW_ROW_THRESHOLD), true);
  assert.equal(isAbortError(new CsvOperationCancelledError()), true);
  assert.equal(
    isAbortError(
      Object.assign(new Error('native abort'), { name: 'AbortError' })
    ),
    true
  );
  assert.equal(isAbortError(new Error('not abort')), false);
  assert.equal(isAbortError('AbortError'), false);
});

test('prefix indexing rejects invalid record limits', async () => {
  const filePath = await writeFixture('invalid-limit.csv', 'a\n1');

  await assert.rejects(
    indexCsvFile(filePath, { recordLimit: -1 }),
    /recordLimit must be 0 or a positive whole number/
  );
  await assert.rejects(
    indexCsvFile(filePath, { recordLimit: Number.NaN }),
    /recordLimit must be 0 or a positive whole number/
  );
});

async function writeFixture(
  fileName: string,
  contents: string
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, contents, 'utf8');
  return filePath;
}
