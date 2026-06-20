import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

export const DEFAULT_MAX_ROWS = 20;
export const DEFAULT_FIRST_ROW_IS_HEADER = true;
export const DEFAULT_WRAP_CELL_CONTENTS = true;
export const INDEXED_PREVIEW_ROW_THRESHOLD = 200;

const COMMA = 44;
const CARRIAGE_RETURN = 13;
const LINE_FEED = 10;
const QUOTE = 34;

export interface ViewerSettings {
  readonly maxRows: number;
  readonly firstRowIsHeader: boolean;
  readonly wrapCellContents: boolean;
}

export interface CsvShape {
  readonly rowCount: number;
  readonly columnCount: number;
  readonly recordCount: number;
}

export interface CsvShapeProgress {
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly percent: number;
  readonly recordCount: number;
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface CsvRecordIndex {
  readonly fileSize: number;
  readonly recordOffsets: number[];
  readonly indexedRecordCount: number;
  readonly indexedEndOffset: number;
  readonly isComplete: boolean;
  readonly maxColumnCount: number;
}

export interface CsvIndexProgress {
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly percent: number;
  readonly indexedRecordCount: number;
  readonly columnCount: number;
}

export interface CsvTableRow {
  readonly rowNumber: number;
  readonly cells: string[];
}

export interface CsvPreview {
  readonly headers: string[];
  readonly headerFields: string[];
  readonly rows: CsvTableRow[];
  readonly loadedRowCount: number;
  readonly displayLimit: number;
  readonly columnCount: number;
  readonly indexedRecordCount: number;
  readonly isComplete: boolean;
}

export interface IndexCsvFileOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CsvIndexProgress) => void;
  readonly progressIntervalMs?: number;
  readonly chunkSize?: number;
  readonly recordLimit?: number;
}

export interface ScanCsvShapeOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CsvShapeProgress) => void;
  readonly progressIntervalMs?: number;
  readonly chunkSize?: number;
  readonly firstRowIsHeader: boolean;
}

export interface ReadCsvPreviewOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CsvPreviewProgress) => void;
  readonly progressIntervalMs?: number;
  readonly chunkSize?: number;
}

export interface CsvPreviewProgress {
  readonly loadedRowCount: number;
  readonly displayLimit: number;
  readonly percent: number;
}

export interface FetchCsvRowsOptions {
  readonly start: number;
  readonly count: number;
  readonly firstRowIsHeader: boolean;
  readonly columnCount: number;
}

export interface CsvRows {
  readonly start: number;
  readonly rows: CsvTableRow[];
  readonly indexedDataRowCount: number;
}

interface CsvRecordScanEvent {
  readonly recordNumber: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly fieldCount: number;
}

interface CsvFileScanResult {
  readonly fileSize: number;
  readonly recordCount: number;
  readonly maxColumnCount: number;
  readonly scannedEndOffset: number;
  readonly isComplete: boolean;
}

interface ScanCsvFileInternalOptions {
  readonly signal?: AbortSignal;
  readonly onRecord?: (record: CsvRecordScanEvent) => void;
  readonly onProgress?: (result: CsvFileScanResult) => void;
  readonly progressIntervalMs?: number;
  readonly chunkSize?: number;
  readonly recordLimit?: number;
}

export class CsvOperationCancelledError extends Error {
  public constructor() {
    super('Operation cancelled.');
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof CsvOperationCancelledError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

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

export async function scanCsvShape(
  filePath: string,
  options: ScanCsvShapeOptions
): Promise<CsvShape> {
  const firstRowIsHeader = options.firstRowIsHeader;
  const result = await scanCsvFileInternal(filePath, {
    signal: options.signal,
    chunkSize: options.chunkSize,
    progressIntervalMs: options.progressIntervalMs,
    onProgress: (progress) => {
      options.onProgress?.({
        bytesRead: progress.scannedEndOffset,
        totalBytes: progress.fileSize,
        percent:
          progress.fileSize === 0
            ? 100
            : Math.min(
                100,
                (progress.scannedEndOffset / progress.fileSize) * 100
              ),
        recordCount: progress.recordCount,
        rowCount: getDataRowCount(progress.recordCount, firstRowIsHeader),
        columnCount: progress.maxColumnCount
      });
    }
  });

  return shapeFromRecordScan(
    result.recordCount,
    result.maxColumnCount,
    firstRowIsHeader
  );
}

export async function indexCsvFile(
  filePath: string,
  options: IndexCsvFileOptions = {}
): Promise<CsvRecordIndex> {
  const recordLimit = parseOptionalRecordLimit(options.recordLimit);
  const recordOffsets: number[] = [];

  const result = await scanCsvFileInternal(filePath, {
    signal: options.signal,
    chunkSize: options.chunkSize,
    progressIntervalMs: options.progressIntervalMs,
    recordLimit,
    onRecord: (record) => {
      if (record.recordNumber === 1) {
        recordOffsets.push(record.startOffset);
      }

      if (recordLimit === undefined || record.recordNumber < recordLimit) {
        recordOffsets.push(record.endOffset);
      }
    },
    onProgress: (progress) => {
      options.onProgress?.({
        bytesRead: progress.scannedEndOffset,
        totalBytes: progress.fileSize,
        percent:
          progress.fileSize === 0
            ? 100
            : Math.min(
                100,
                (progress.scannedEndOffset / progress.fileSize) * 100
              ),
        indexedRecordCount: progress.recordCount,
        columnCount: progress.maxColumnCount
      });
    }
  });
  while (recordOffsets.length > result.recordCount) {
    recordOffsets.pop();
  }

  return {
    fileSize: result.fileSize,
    recordOffsets,
    indexedRecordCount: result.recordCount,
    indexedEndOffset: result.scannedEndOffset,
    isComplete: result.isComplete,
    maxColumnCount: result.maxColumnCount
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

export function parseCsvRecordsFromText(input: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let fieldAtStart = true;
  let inQuotes = false;
  let quotePending = false;
  let pendingCarriageReturn = false;
  let recordHasCharacters = false;

  const appendFieldCharacter = (value: string): void => {
    field += value;
    fieldAtStart = false;
    recordHasCharacters = true;
  };

  const endRecord = (force: boolean): void => {
    if (!force && !recordHasCharacters && row.length === 0 && field === '') {
      return;
    }

    row.push(field);
    records.push(row);
    row = [];
    field = '';
    fieldAtStart = true;
    recordHasCharacters = false;
  };

  const processOutsideQuotes = (char: string): void => {
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      if (char === '\n') {
        endRecord(true);
        return;
      }

      endRecord(true);
    }

    if (char === ',') {
      row.push(field);
      field = '';
      fieldAtStart = true;
      recordHasCharacters = true;
      return;
    }

    if (char === '\r') {
      pendingCarriageReturn = true;
      return;
    }

    if (char === '\n') {
      endRecord(true);
      return;
    }

    if (char === '"' && fieldAtStart) {
      inQuotes = true;
      fieldAtStart = false;
      recordHasCharacters = true;
      return;
    }

    appendFieldCharacter(char);
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index);

    if (inQuotes) {
      if (quotePending) {
        if (char === '"') {
          appendFieldCharacter('"');
          quotePending = false;
          continue;
        }

        quotePending = false;
        inQuotes = false;
        processOutsideQuotes(char);
        continue;
      }

      if (char === '"') {
        quotePending = true;
        continue;
      }

      appendFieldCharacter(char);
      continue;
    }

    processOutsideQuotes(char);
  }

  if (pendingCarriageReturn) {
    pendingCarriageReturn = false;
    endRecord(true);
  } else {
    quotePending = false;
    inQuotes = false;
    endRecord(false);
  }

  return records;
}

export function normalizeHeaders(
  headerFields: readonly string[],
  columnCount: number
): string[] {
  return Array.from({ length: columnCount }, (_, index) => {
    const value = headerFields[index];
    return value && value.trim() !== '' ? value : `Column ${index + 1}`;
  });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return String(bytes) + ' B';
  }

  return value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
}

async function scanCsvFileInternal(
  filePath: string,
  options: ScanCsvFileInternalOptions = {}
): Promise<CsvFileScanResult> {
  throwIfAborted(options.signal);

  const recordLimit = parseOptionalRecordLimit(options.recordLimit);
  const stats = await fsp.stat(filePath);
  const totalBytes = stats.size;

  let recordCount = 0;
  let maxColumnCount = 0;
  let scannedEndOffset = 0;
  let isComplete = true;
  let lastProgressAt = 0;
  const progressIntervalMs = options.progressIntervalMs ?? 100;

  const currentResult = (): CsvFileScanResult => ({
    fileSize: totalBytes,
    recordCount,
    maxColumnCount,
    scannedEndOffset,
    isComplete
  });

  const emitProgress = (force: boolean): void => {
    if (!options.onProgress) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastProgressAt < progressIntervalMs) {
      return;
    }

    lastProgressAt = now;
    options.onProgress(currentResult());
  };

  if (totalBytes === 0) {
    emitProgress(true);
    return currentResult();
  }

  if (recordLimit === 0) {
    isComplete = false;
    emitProgress(true);
    return currentResult();
  }

  let recordStartOffset = 0;
  let fieldCount = 1;
  let fieldAtStart = true;
  let inQuotes = false;
  let quotePending = false;
  let pendingCarriageReturnOffset: number | undefined;
  let bytesRead = 0;
  let stopped = false;

  const completeRecord = (endOffset: number): void => {
    recordCount += 1;
    maxColumnCount = Math.max(maxColumnCount, fieldCount);
    scannedEndOffset = endOffset;
    options.onRecord?.({
      recordNumber: recordCount,
      startOffset: recordStartOffset,
      endOffset,
      fieldCount
    });

    recordStartOffset = endOffset;
    fieldCount = 1;
    fieldAtStart = true;
    inQuotes = false;
    quotePending = false;
    pendingCarriageReturnOffset = undefined;

    if (recordLimit !== undefined && recordCount >= recordLimit) {
      stopped = true;
      isComplete = endOffset >= totalBytes;
    }
  };

  const processOutsideQuotes = (byte: number, offset: number): void => {
    if (pendingCarriageReturnOffset !== undefined) {
      const carriageReturnOffset = pendingCarriageReturnOffset;
      pendingCarriageReturnOffset = undefined;

      if (byte === LINE_FEED) {
        completeRecord(offset + 1);
        return;
      }

      completeRecord(carriageReturnOffset + 1);
      if (stopped) {
        return;
      }
    }

    if (byte === COMMA) {
      fieldCount += 1;
      fieldAtStart = true;
      return;
    }

    if (byte === CARRIAGE_RETURN) {
      pendingCarriageReturnOffset = offset;
      return;
    }

    if (byte === LINE_FEED) {
      completeRecord(offset + 1);
      return;
    }

    if (byte === QUOTE && fieldAtStart) {
      inQuotes = true;
      fieldAtStart = false;
      return;
    }

    fieldAtStart = false;
  };

  const processByte = (byte: number, offset: number): void => {
    if (stopped) {
      return;
    }

    if (inQuotes) {
      if (quotePending) {
        if (byte === QUOTE) {
          quotePending = false;
          fieldAtStart = false;
          return;
        }

        quotePending = false;
        inQuotes = false;
        processOutsideQuotes(byte, offset);
        return;
      }

      if (byte === QUOTE) {
        quotePending = true;
        return;
      }

      fieldAtStart = false;
      return;
    }

    processOutsideQuotes(byte, offset);
  };

  const stream = fs.createReadStream(filePath, {
    highWaterMark: options.chunkSize ?? 64 * 1024
  });

  try {
    emitProgress(true);

    for await (const chunk of stream) {
      throwIfAborted(options.signal);

      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as ArrayBuffer);
      const chunkStartOffset = bytesRead;

      for (let index = 0; index < buffer.length; index += 1) {
        processByte(buffer[index] ?? 0, chunkStartOffset + index);

        if (stopped) {
          bytesRead = scannedEndOffset;
          break;
        }
      }

      if (!stopped) {
        bytesRead += buffer.length;
        scannedEndOffset = bytesRead;
      }

      emitProgress(false);
      throwIfAborted(options.signal);

      if (stopped) {
        break;
      }
    }
  } finally {
    stream.destroy();
  }

  throwIfAborted(options.signal);

  if (!stopped) {
    if (pendingCarriageReturnOffset !== undefined) {
      completeRecord(pendingCarriageReturnOffset + 1);
    } else if (totalBytes > recordStartOffset) {
      quotePending = false;
      inQuotes = false;
      completeRecord(totalBytes);
    }

    scannedEndOffset = totalBytes;
    isComplete = true;
  }

  emitProgress(true);
  return currentResult();
}

function normalizeCells(
  fields: readonly string[],
  columnCount: number
): string[] {
  return Array.from({ length: columnCount }, (_, index) => fields[index] ?? '');
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

function parseOptionalRecordLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('recordLimit must be 0 or a positive whole number.');
  }

  return value;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CsvOperationCancelledError();
  }
}
