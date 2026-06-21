import type {
  CsvPreview,
  CsvRecordIndex,
  CsvShape,
  ViewerSettings
} from '../csv';
import type { FileSnapshot } from './snapshots';

export interface CsvDataPayload {
  readonly fileName: string;
  readonly fileSize: string;
  readonly lastModified: string;
  readonly maxRows: number;
  readonly firstRowIsHeader: boolean;
  readonly wrapCellContents: boolean;
  readonly shape: CsvShape | null;
  readonly preview: CsvPreview;
}

export interface ExactShapeCache {
  readonly snapshot: FileSnapshot;
  readonly recordCount: number;
  readonly columnCount: number;
}

export interface ExactShapeRequest {
  readonly snapshot: FileSnapshot;
  readonly controller: AbortController;
}

export interface SuccessfulLoadState {
  readonly settings: ViewerSettings;
  readonly snapshot: FileSnapshot;
  readonly fullIndex?: CsvRecordIndex;
}

export interface ExactShapeCoordinator {
  readonly noteFileSnapshot: (snapshot: FileSnapshot) => void;
  readonly getCachedShape: (
    snapshot: FileSnapshot,
    firstRowIsHeader: boolean
  ) => CsvShape | undefined;
  readonly setCachedShape: (snapshot: FileSnapshot, shape: CsvShape) => void;
  readonly ensureExactShape: (snapshot: FileSnapshot) => void;
}

export interface WebviewMessage {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly start?: unknown;
  readonly count?: unknown;
  readonly value?: unknown;
}
