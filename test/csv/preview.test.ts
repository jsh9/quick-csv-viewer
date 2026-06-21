import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_FIRST_ROW_IS_HEADER,
  DEFAULT_MAX_ROWS,
  DEFAULT_WRAP_CELL_CONTENTS,
  isAbortError,
  normalizeViewerSettings,
  readCsvPreview
} from '../../src/csv';
import { writeFixture } from '../support/csv-fixtures';

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
