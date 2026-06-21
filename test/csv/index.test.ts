import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchCsvRecordRange,
  fetchCsvRows,
  indexCsvFile,
  scanCsvShape
} from '../../src/csv';
import { writeFixture } from '../support/csv-fixtures';

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
