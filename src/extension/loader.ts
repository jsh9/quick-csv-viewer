import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CsvPreview,
  CsvRecordIndex,
  CsvShape,
  ViewerSettings,
  fetchCsvHeaders,
  formatFileSize,
  getDataRowCount,
  getDisplayRowCount,
  getRecordLimit,
  indexCsvFile,
  isAbortError,
  readCsvPreview,
  scanCsvShape,
  shapeFromRecordScan,
  shouldUseIndexedPreview
} from '../csv';
import { getFileSnapshot, isSameFileSnapshot, FileSnapshot } from './snapshots';
import type {
  CsvDataPayload,
  ExactShapeCoordinator,
  SuccessfulLoadState
} from './types';
import { formatError } from './utils';

export async function postCsvData(
  uri: vscode.Uri,
  webview: vscode.Webview,
  generation: number,
  getLatestGeneration: () => number,
  signal: AbortSignal,
  settings: ViewerSettings,
  setFullIndex: (index: CsvRecordIndex) => void,
  noteSuccessfulLoad: (state: SuccessfulLoadState) => void,
  exactShapes: ExactShapeCoordinator
): Promise<void> {
  if (uri.scheme !== 'file') {
    await webview.postMessage({
      type: 'error',
      message: `Quick CSV Viewer only supports file-backed CSV documents. Unsupported URI scheme: ${uri.scheme}.`
    });
    return;
  }

  await webview.postMessage({ type: 'loading' });

  try {
    const stats = await fs.stat(uri.fsPath);
    const snapshot = getFileSnapshot(stats);
    exactShapes.noteFileSnapshot(snapshot);
    const metadata = {
      fileName: path.basename(uri.fsPath),
      fileSize: formatFileSize(stats.size),
      lastModified: stats.mtime.toLocaleString(),
      maxRows: settings.maxRows,
      firstRowIsHeader: settings.firstRowIsHeader,
      wrapCellContents: settings.wrapCellContents
    };

    if (shouldUseIndexedPreview(settings.maxRows)) {
      await webview.postMessage({
        type: 'fullIndexStart',
        payload: {
          ...metadata,
          totalBytes: stats.size
        }
      });

      const index = await indexCsvFile(uri.fsPath, {
        signal,
        recordLimit: getRecordLimit(settings),
        onProgress: (progress) => {
          if (generation !== getLatestGeneration()) {
            return;
          }

          void webview.postMessage({
            type: 'fullIndexProgress',
            payload: progress
          });
        }
      });

      if (generation !== getLatestGeneration()) {
        return;
      }

      setFullIndex(index);
      if (index.isComplete) {
        exactShapes.setCachedShape(
          snapshot,
          shapeFromRecordScan(
            index.indexedRecordCount,
            index.maxColumnCount,
            settings.firstRowIsHeader
          )
        );
      }

      const shape =
        exactShapes.getCachedShape(snapshot, settings.firstRowIsHeader) ?? null;
      const columnCount = shape?.columnCount ?? index.maxColumnCount;
      const headers = await fetchCsvHeaders(uri.fsPath, index, {
        firstRowIsHeader: settings.firstRowIsHeader,
        columnCount
      });
      const indexedDataRowCount = getDataRowCount(
        index.indexedRecordCount,
        settings.firstRowIsHeader
      );

      await webview.postMessage({
        type: 'fullIndexReady',
        payload: {
          ...metadata,
          shape,
          totalRows: getDisplayRowCount(indexedDataRowCount, settings.maxRows),
          isComplete: index.isComplete,
          columnCount,
          headers: headers.headers,
          headerFields: headers.headerFields
        }
      });
      noteSuccessfulLoad({
        settings: { ...settings },
        snapshot,
        fullIndex: index
      });

      if (shouldStartExactShape(index)) {
        exactShapes.ensureExactShape(snapshot);
      }

      return;
    }

    await webview.postMessage({
      type: 'previewLoadStart',
      payload: {
        ...metadata,
        displayLimit: settings.maxRows
      }
    });

    const preview = await readCsvPreview(uri.fsPath, settings, {
      signal,
      onProgress: (progress) => {
        if (generation !== getLatestGeneration()) {
          return;
        }

        void webview.postMessage({
          type: 'previewLoadProgress',
          payload: progress
        });
      }
    });

    if (generation !== getLatestGeneration()) {
      return;
    }

    if (preview.isComplete) {
      exactShapes.setCachedShape(
        snapshot,
        shapeFromRecordScan(
          preview.indexedRecordCount,
          preview.columnCount,
          settings.firstRowIsHeader
        )
      );
    }

    await webview.postMessage({
      type: 'data',
      payload: {
        ...metadata,
        shape:
          exactShapes.getCachedShape(snapshot, settings.firstRowIsHeader) ??
          null,
        preview
      } satisfies CsvDataPayload
    });
    noteSuccessfulLoad({
      settings: { ...settings },
      snapshot
    });

    if (shouldStartExactShape(preview)) {
      exactShapes.ensureExactShape(snapshot);
    }
  } catch (error) {
    if (generation !== getLatestGeneration()) {
      return;
    }

    if (isAbortError(error)) {
      return;
    }

    await webview.postMessage({
      type: 'error',
      message: formatError(error)
    });
  }
}

function shouldStartExactShape(
  value?: Pick<CsvRecordIndex | CsvPreview, 'isComplete'>
): boolean {
  return value ? !value.isComplete : true;
}

export function startExactShapeScan(
  filePath: string,
  webview: vscode.Webview,
  snapshot: FileSnapshot,
  getCurrentFileSnapshot: () => FileSnapshot | undefined,
  getCurrentSettings: () => ViewerSettings,
  signal: AbortSignal,
  setCachedShape: (snapshot: FileSnapshot, shape: CsvShape) => void,
  clearExactShapeRequest: (snapshot: FileSnapshot) => void
): void {
  const isCurrentSnapshot = (): boolean => {
    const currentSnapshot = getCurrentFileSnapshot();
    return Boolean(
      currentSnapshot && isSameFileSnapshot(currentSnapshot, snapshot)
    );
  };

  void scanCsvShape(filePath, {
    signal,
    firstRowIsHeader: getCurrentSettings().firstRowIsHeader,
    onProgress: (progress) => {
      if (!isCurrentSnapshot()) {
        return;
      }

      void webview.postMessage({
        type: 'shapeProgress',
        payload: progress
      });
    }
  })
    .then(async (shape) => {
      if (!isCurrentSnapshot() || signal.aborted) {
        return;
      }

      const currentShape = shapeFromRecordScan(
        shape.recordCount,
        shape.columnCount,
        getCurrentSettings().firstRowIsHeader
      );
      setCachedShape(snapshot, currentShape);
      await webview.postMessage({
        type: 'shape',
        shape: currentShape
      });
    })
    .catch(async (error: unknown) => {
      if (!isCurrentSnapshot() || isAbortError(error)) {
        return;
      }

      await webview.postMessage({
        type: 'shapeError',
        message: formatError(error)
      });
    })
    .finally(() => {
      clearExactShapeRequest(snapshot);
    });
}
