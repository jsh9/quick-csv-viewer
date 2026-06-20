import { throwIfAborted } from './errors';
import { fetchCsvHeaders, fetchCsvRows } from './records';
import {
  getDataRowCount,
  getDisplayRowCount,
  getRecordLimit
} from './settings';
import { indexCsvFile } from './scanner';
import type {
  CsvPreview,
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
