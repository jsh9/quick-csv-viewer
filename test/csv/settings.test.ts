import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CsvOperationCancelledError,
  DEFAULT_FIRST_ROW_IS_HEADER,
  DEFAULT_MAX_ROWS,
  DEFAULT_WRAP_CELL_CONTENTS,
  INDEXED_PREVIEW_ROW_THRESHOLD,
  getDataRowCount,
  getDisplayRowCount,
  getRecordLimit,
  isAbortError,
  normalizeViewerSettings,
  shouldUseIndexedPreview
} from '../../src/csv';

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
