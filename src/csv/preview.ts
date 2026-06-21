import * as fsp from 'node:fs/promises';
import { throwIfAborted } from './errors';
import {
  normalizeCells,
  normalizeHeaders,
  parseCsvRecordsFromText
} from './parser';
import { indexCsvFile } from './scan';
import {
  getDataRowCount,
  getDisplayRowCount,
  getRecordLimit
} from './settings';
import type {
  CsvPreview,
  CsvRecordIndex,
  CsvRows,
  FetchCsvRowsOptions,
  ReadCsvPreviewOptions,
  ViewerSettings
} from './types';

export async function readCsvPreview(
  filePath: string,
  settings: Pick<ViewerSettings, 'maxRows' | 'firstRowIsHeader'>,
  options: ReadCsvPreviewOptions = {}
): Promise<CsvPreview> {
  throwIfAborted(options.signal);

  const displayLimit = settings.maxRows;
  const progressIntervalMs = options.progressIntervalMs ?? 100;
  let lastProgressAt = 0;

  const emitProgress = (loadedRowCount: number, force: boolean): void => {
    if (!options.onProgress) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastProgressAt < progressIntervalMs) {
      return;
    }

    lastProgressAt = now;
    options.onProgress({
      loadedRowCount,
      displayLimit,
      percent:
        displayLimit <= 0
          ? 0
          : Math.min(100, (loadedRowCount / displayLimit) * 100)
    });
  };

  emitProgress(0, true);

  const index = await indexCsvFile(filePath, {
    signal: options.signal,
    chunkSize: options.chunkSize,
    recordLimit: getRecordLimit(settings)
  });
  const columnCount = index.maxColumnCount;
  const headers = await fetchCsvHeaders(filePath, index, {
    firstRowIsHeader: settings.firstRowIsHeader,
    columnCount
  });
  const indexedDataRowCount = getDataRowCount(
    index.indexedRecordCount,
    settings.firstRowIsHeader
  );
  const rowCount = getDisplayRowCount(indexedDataRowCount, settings.maxRows);
  const rows = await fetchCsvRows(filePath, index, {
    start: 0,
    count: rowCount,
    firstRowIsHeader: settings.firstRowIsHeader,
    columnCount
  });

  emitProgress(rows.rows.length, true);

  return {
    headers: headers.headers,
    headerFields: headers.headerFields,
    rows: rows.rows,
    loadedRowCount: rows.rows.length,
    displayLimit,
    columnCount,
    indexedRecordCount: index.indexedRecordCount,
    isComplete: index.isComplete
  };
}

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
