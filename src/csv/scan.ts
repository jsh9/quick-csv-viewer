import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { throwIfAborted } from './errors';
import { getDataRowCount, shapeFromRecordScan } from './settings';
import type {
  CsvRecordIndex,
  CsvShape,
  IndexCsvFileOptions,
  ScanCsvShapeOptions
} from './types';

const COMMA = 44;
const CARRIAGE_RETURN = 13;
const LINE_FEED = 10;
const QUOTE = 34;

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

function parseOptionalRecordLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('recordLimit must be 0 or a positive whole number.');
  }

  return value;
}
