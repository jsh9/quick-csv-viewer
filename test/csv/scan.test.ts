import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexCsvFile, readCsvPreview, scanCsvShape } from '../../src/csv';
import { writeFixture } from '../support/csv-fixtures';

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
