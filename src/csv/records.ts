import * as fsp from 'node:fs/promises';
import {
  normalizeCells,
  normalizeHeaders,
  parseCsvRecordsFromText
} from './parser';
import { getDataRowCount } from './settings';
import type { CsvRecordIndex, CsvRows, FetchCsvRowsOptions } from './types';

export async function fetchCsvHeaders(
  filePath: string,
  recordIndex: CsvRecordIndex,
  options: {
    readonly firstRowIsHeader: boolean;
    readonly columnCount: number;
  }
): Promise<{ readonly headers: string[]; readonly headerFields: string[] }> {
  const headerFields =
    options.firstRowIsHeader && recordIndex.indexedRecordCount > 0
      ? ((await fetchCsvRecordRange(filePath, recordIndex, 0, 1))[0] ?? [])
      : [];

  return {
    headerFields,
    headers: normalizeHeaders(headerFields, options.columnCount)
  };
}

export async function fetchCsvRows(
  filePath: string,
  recordIndex: CsvRecordIndex,
  options: FetchCsvRowsOptions
): Promise<CsvRows> {
  const indexedDataRowCount = getDataRowCount(
    recordIndex.indexedRecordCount,
    options.firstRowIsHeader
  );
  const start = clampInteger(options.start, 0, indexedDataRowCount);
  const count = clampInteger(options.count, 0, indexedDataRowCount - start);
  const recordStart = start + (options.firstRowIsHeader ? 1 : 0);
  const records = await fetchCsvRecordRange(
    filePath,
    recordIndex,
    recordStart,
    count
  );
  const rows = records.map((record, index) => ({
    rowNumber: start + index + 1,
    cells: normalizeCells(record, options.columnCount)
  }));

  return {
    start,
    rows,
    indexedDataRowCount
  };
}

export async function fetchCsvRecordRange(
  filePath: string,
  recordIndex: CsvRecordIndex,
  start: number,
  count: number
): Promise<string[][]> {
  const clampedStart = clampInteger(start, 0, recordIndex.indexedRecordCount);
  const clampedCount = clampInteger(
    count,
    0,
    recordIndex.indexedRecordCount - clampedStart
  );
  const end = Math.min(
    recordIndex.indexedRecordCount,
    clampedStart + clampedCount
  );

  if (clampedCount === 0 || clampedStart >= end) {
    return [];
  }

  const startOffset = recordIndex.recordOffsets[clampedStart];
  if (startOffset === undefined) {
    return [];
  }

  const endOffset =
    end < recordIndex.recordOffsets.length
      ? recordIndex.recordOffsets[end]
      : recordIndex.indexedEndOffset;
  const length = endOffset - startOffset;

  if (length <= 0) {
    return [];
  }

  const file = await fsp.open(filePath, 'r');

  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await file.read(buffer, 0, length, startOffset);
    const text = Buffer.from(buffer.subarray(0, bytesRead)).toString('utf8');
    return parseCsvRecordsFromText(text).slice(0, clampedCount);
  } finally {
    await file.close();
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
