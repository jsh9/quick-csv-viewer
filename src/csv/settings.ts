import {
  DEFAULT_FIRST_ROW_IS_HEADER,
  DEFAULT_MAX_ROWS,
  DEFAULT_WRAP_CELL_CONTENTS,
  INDEXED_PREVIEW_ROW_THRESHOLD
} from './constants';
import type { CsvShape, ViewerSettings } from './types';

export function normalizeViewerSettings(input: {
  readonly maxRows?: unknown;
  readonly firstRowIsHeader?: unknown;
  readonly wrapCellContents?: unknown;
}): ViewerSettings {
  return {
    maxRows: normalizeInteger(input.maxRows, DEFAULT_MAX_ROWS, 0),
    firstRowIsHeader:
      typeof input.firstRowIsHeader === 'boolean'
        ? input.firstRowIsHeader
        : DEFAULT_FIRST_ROW_IS_HEADER,
    wrapCellContents:
      typeof input.wrapCellContents === 'boolean'
        ? input.wrapCellContents
        : DEFAULT_WRAP_CELL_CONTENTS
  };
}

export function shouldUseIndexedPreview(maxRows: number): boolean {
  return maxRows === 0 || maxRows >= INDEXED_PREVIEW_ROW_THRESHOLD;
}

export function getRecordLimit(
  settings: Pick<ViewerSettings, 'maxRows' | 'firstRowIsHeader'>
): number | undefined {
  if (settings.maxRows === 0) {
    return undefined;
  }

  return settings.maxRows + (settings.firstRowIsHeader ? 1 : 0);
}

export function getDataRowCount(
  recordCount: number,
  firstRowIsHeader: boolean
): number {
  return firstRowIsHeader ? Math.max(0, recordCount - 1) : recordCount;
}

export function getDisplayRowCount(
  dataRowCount: number,
  maxRows: number
): number {
  return maxRows === 0 ? dataRowCount : Math.min(dataRowCount, maxRows);
}

export function shapeFromRecordScan(
  recordCount: number,
  columnCount: number,
  firstRowIsHeader: boolean
): CsvShape {
  return {
    rowCount: getDataRowCount(recordCount, firstRowIsHeader),
    columnCount,
    recordCount
  };
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    return fallback;
  }

  return value;
}
