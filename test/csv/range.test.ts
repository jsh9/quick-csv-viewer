import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchCsvHeaders,
  fetchCsvRecordRange,
  fetchCsvRows,
  indexCsvFile
} from '../../src/csv';
import { writeFixture } from '../support/csv-fixtures';

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
