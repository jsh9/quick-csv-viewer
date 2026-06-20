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
