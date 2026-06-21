import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchCsvRecordRange,
  indexCsvFile,
  isAbortError,
  readCsvPreview,
  scanCsvShape
} from '../../src/csv';
import { getFixturePath, writeFixture } from '../support/csv-fixtures';

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
  const missingPath = getFixturePath('missing.csv');
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
