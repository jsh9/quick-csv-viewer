import * as nodeFs from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CsvPreview,
  CsvRecordIndex,
  CsvShape,
  CsvTableRow,
  ViewerSettings,
  fetchCsvHeaders,
  fetchCsvRows,
  formatFileSize,
  getDataRowCount,
  getDisplayRowCount,
  getRecordLimit,
  indexCsvFile,
  INDEXED_PREVIEW_ROW_THRESHOLD,
  isAbortError,
  normalizeViewerSettings,
  readCsvPreview,
  scanCsvShape,
  shapeFromRecordScan,
  shouldUseIndexedPreview
} from './csv';

const VIEW_TYPE = 'quickCsvViewer.viewer';
const SETTINGS_SECTION = 'quickCsvViewer';
const SAMPLE_CSV_PATHS = [
  'sample-data/sample-data.csv',
  'sample-data/small-ragged-unicode.csv',
  'sample-data/large-placeholder.csv',
  'sample-data/large-unicode-ragged.csv',
  'sample-data/large-long-cells.csv'
];
const FILE_RELOAD_DEBOUNCE_MS = 150;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'quickCsvViewer.openCurrentFile',
      (resource?: vscode.Uri) => {
        void openCsvViewer(resource).catch((error: unknown) => {
          void vscode.window.showErrorMessage(
            `Quick CSV Viewer failed to open the file: ${formatError(error)}`
          );
        });
      }
    ),
    vscode.commands.registerCommand('quickCsvViewer.openSampleFiles', () => {
      void openSampleCsvFiles(context.extensionUri).catch((error: unknown) => {
        void vscode.window.showErrorMessage(
          `Quick CSV Viewer failed to open sample files: ${formatError(error)}`
        );
      });
    }),
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new CsvViewerProvider(),
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
          enableFindWidget: true,
          retainContextWhenHidden: true
        }
      }
    )
  );
}

export function deactivate(): void {
  // Nothing to dispose; VS Code owns provider subscriptions registered on activation.
}

async function openCsvViewer(resource?: vscode.Uri): Promise<void> {
  const uri = resource ?? getActiveEditorUri();

  if (!uri) {
    void vscode.window.showWarningMessage(
      'Open a CSV file before running Quick CSV Viewer.'
    );
    return;
  }

  if (!isCsvFile(uri)) {
    void vscode.window.showWarningMessage(
      'Quick CSV Viewer can only open .csv files.'
    );
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.openWith',
    uri,
    VIEW_TYPE,
    vscode.ViewColumn.Active
  );
}

async function openSampleCsvFiles(extensionUri: vscode.Uri): Promise<void> {
  let openedCount = 0;

  for (const [index, relativePath] of SAMPLE_CSV_PATHS.entries()) {
    const uri = vscode.Uri.joinPath(extensionUri, ...relativePath.split('/'));
    try {
      await fs.access(uri.fsPath);
    } catch {
      continue;
    }

    const column =
      openedCount === 0 ? vscode.ViewColumn.One : vscode.ViewColumn.Beside;
    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      VIEW_TYPE,
      column
    );
    openedCount += 1;
  }

  if (openedCount === 0) {
    void vscode.window.showWarningMessage(
      'No sample CSV files found. Run python3 sample-data/generate_large_csv.py first.'
    );
  }
}

function getActiveEditorUri(): vscode.Uri | undefined {
  const activeTextEditorUri = vscode.window.activeTextEditor?.document.uri;

  if (activeTextEditorUri) {
    return activeTextEditorUri;
  }

  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputCustom
  ) {
    return input.uri;
  }

  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }

  return undefined;
}

function isCsvFile(uri: vscode.Uri): boolean {
  return (
    uri.scheme === 'file' && path.extname(uri.fsPath).toLowerCase() === '.csv'
  );
}

class CsvDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {
    // No document-level resources are held.
  }
}

class CsvViewerProvider implements vscode.CustomReadonlyEditorProvider<CsvDocument> {
  public async openCustomDocument(uri: vscode.Uri): Promise<CsvDocument> {
    return new CsvDocument(uri);
  }

  public async resolveCustomEditor(
    document: CsvDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true
    };
    webviewPanel.webview.html = getHtml(path.basename(document.uri.fsPath));
    webviewPanel.reveal(webviewPanel.viewColumn, false);

    const disposables: vscode.Disposable[] = [];
    let generation = 0;
    let webviewReady = false;
    let abortController: AbortController | undefined;
    let fullIndex: CsvRecordIndex | undefined;
    let currentSettings = getSettings();
    let fileReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let currentFileSnapshot: FileSnapshot | undefined;
    let exactShapeCache: ExactShapeCache | undefined;
    let exactShapeRequest: ExactShapeRequest | undefined;

    const cancelCurrentWork = (): void => {
      abortController?.abort();
      abortController = undefined;
      fullIndex = undefined;
    };

    const abortExactShape = (): void => {
      exactShapeRequest?.controller.abort();
      exactShapeRequest = undefined;
    };

    const invalidateExactShape = (): void => {
      abortExactShape();
      exactShapeCache = undefined;
    };

    const getCachedShape = (
      snapshot: FileSnapshot,
      firstRowIsHeader: boolean
    ): CsvShape | undefined => {
      if (
        !exactShapeCache ||
        !isSameFileSnapshot(exactShapeCache.snapshot, snapshot)
      ) {
        return undefined;
      }

      return shapeFromRecordScan(
        exactShapeCache.recordCount,
        exactShapeCache.columnCount,
        firstRowIsHeader
      );
    };

    const noteFileSnapshot = (snapshot: FileSnapshot): void => {
      if (
        currentFileSnapshot &&
        isSameFileSnapshot(currentFileSnapshot, snapshot)
      ) {
        return;
      }

      invalidateExactShape();
      currentFileSnapshot = snapshot;
    };

    const setCachedShape = (snapshot: FileSnapshot, shape: CsvShape): void => {
      exactShapeCache = {
        snapshot,
        recordCount: shape.recordCount,
        columnCount: shape.columnCount
      };

      if (
        exactShapeRequest &&
        isSameFileSnapshot(exactShapeRequest.snapshot, snapshot)
      ) {
        exactShapeRequest.controller.abort();
        exactShapeRequest = undefined;
      }
    };

    const clearExactShapeRequest = (snapshot: FileSnapshot): void => {
      if (
        exactShapeRequest &&
        isSameFileSnapshot(exactShapeRequest.snapshot, snapshot)
      ) {
        exactShapeRequest = undefined;
      }
    };

    const ensureExactShape = (snapshot: FileSnapshot): void => {
      if (getCachedShape(snapshot, currentSettings.firstRowIsHeader)) {
        return;
      }

      if (
        exactShapeRequest &&
        isSameFileSnapshot(exactShapeRequest.snapshot, snapshot)
      ) {
        return;
      }

      abortExactShape();
      const controller = new AbortController();
      exactShapeRequest = {
        snapshot,
        controller
      };

      startExactShapeScan(
        document.uri.fsPath,
        webviewPanel.webview,
        snapshot,
        () => currentFileSnapshot,
        () => currentSettings,
        controller.signal,
        setCachedShape,
        clearExactShapeRequest
      );
    };

    const load = async (): Promise<void> => {
      cancelCurrentWork();
      const currentGeneration = ++generation;
      const controller = new AbortController();
      abortController = controller;
      fullIndex = undefined;
      currentSettings = getSettings();

      await postCsvData(
        document.uri,
        webviewPanel.webview,
        currentGeneration,
        () => generation,
        controller.signal,
        currentSettings,
        (index) => {
          fullIndex = index;
        },
        {
          noteFileSnapshot,
          getCachedShape,
          setCachedShape,
          ensureExactShape
        }
      );
    };

    const safeLoad = (): void => {
      if (!webviewReady) {
        return;
      }

      void load().catch(async (error: unknown) => {
        await webviewPanel.webview.postMessage({
          type: 'error',
          message: formatError(error)
        });
      });
    };

    const scheduleFileReload = (): void => {
      if (!webviewReady) {
        return;
      }

      invalidateExactShape();

      if (fileReloadTimer) {
        clearTimeout(fileReloadTimer);
      }

      fileReloadTimer = setTimeout(() => {
        fileReloadTimer = undefined;
        safeLoad();
      }, FILE_RELOAD_DEBOUNCE_MS);
    };

    const getCurrentColumnCount = (): number => {
      const snapshot = currentFileSnapshot;
      const shape = snapshot
        ? getCachedShape(snapshot, currentSettings.firstRowIsHeader)
        : undefined;
      return shape?.columnCount ?? fullIndex?.maxColumnCount ?? 0;
    };

    const handleFetchRows = async (message: WebviewMessage): Promise<void> => {
      if (!fullIndex) {
        await webviewPanel.webview.postMessage({
          type: 'error',
          message: 'The CSV row index is not ready yet.'
        });
        return;
      }

      const requestGeneration = generation;
      const requestId =
        typeof message.requestId === 'string' ? message.requestId : '';
      const indexedDataRowCount = getDataRowCount(
        fullIndex.indexedRecordCount,
        currentSettings.firstRowIsHeader
      );
      const totalRows = getDisplayRowCount(
        indexedDataRowCount,
        currentSettings.maxRows
      );
      const start = clampMessageInteger(message.start, 0, totalRows);
      const count = clampMessageInteger(message.count, 0, totalRows - start);
      const rows = await fetchCsvRows(document.uri.fsPath, fullIndex, {
        start,
        count,
        firstRowIsHeader: currentSettings.firstRowIsHeader,
        columnCount: getCurrentColumnCount()
      });

      if (requestGeneration !== generation) {
        return;
      }

      await webviewPanel.webview.postMessage({
        type: 'rows',
        requestId,
        payload: {
          ...rows,
          start,
          totalRows
        }
      });
    };

    const handleUpdateMaxRows = async (
      message: WebviewMessage
    ): Promise<void> => {
      const value =
        typeof message.value === 'number' ? message.value : Number.NaN;
      if (!Number.isInteger(value) || value < 0) {
        await webviewPanel.webview.postMessage({
          type: 'maxRowsError',
          message: 'Rows must be 0 or a positive whole number.'
        });
        return;
      }

      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update('maxRows', value, vscode.ConfigurationTarget.Global);
    };

    const handleUpdateFirstRowIsHeader = async (
      message: WebviewMessage
    ): Promise<void> => {
      if (typeof message.value !== 'boolean') {
        await webviewPanel.webview.postMessage({
          type: 'settingsError',
          message: 'Header row must be on or off.'
        });
        return;
      }

      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(
          'firstRowIsHeader',
          message.value,
          vscode.ConfigurationTarget.Global
        );
    };

    const handleUpdateWrapCellContents = async (
      message: WebviewMessage
    ): Promise<void> => {
      if (typeof message.value !== 'boolean') {
        await webviewPanel.webview.postMessage({
          type: 'settingsError',
          message: 'Wrap cells must be on or off.'
        });
        return;
      }

      currentSettings = {
        ...currentSettings,
        wrapCellContents: message.value
      };

      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(
          'wrapCellContents',
          message.value,
          vscode.ConfigurationTarget.Global
        );
    };

    disposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === 'ready') {
          webviewReady = true;
          safeLoad();
          return;
        }

        if (message.type === 'cancelIndex') {
          abortController?.abort();
          void webviewPanel.webview.postMessage({ type: 'fullIndexCancelled' });
          return;
        }

        if (message.type === 'fetchRows') {
          void handleFetchRows(message).catch(async (error: unknown) => {
            await webviewPanel.webview.postMessage({
              type: 'error',
              message: formatError(error)
            });
          });
          return;
        }

        if (message.type === 'updateMaxRows') {
          void handleUpdateMaxRows(message).catch(async (error: unknown) => {
            await webviewPanel.webview.postMessage({
              type: 'maxRowsError',
              message: formatError(error)
            });
          });
          return;
        }

        if (message.type === 'updateFirstRowIsHeader') {
          void handleUpdateFirstRowIsHeader(message).catch(
            async (error: unknown) => {
              await webviewPanel.webview.postMessage({
                type: 'settingsError',
                message: formatError(error)
              });
            }
          );
          return;
        }

        if (message.type === 'updateWrapCellContents') {
          void handleUpdateWrapCellContents(message).catch(
            async (error: unknown) => {
              await webviewPanel.webview.postMessage({
                type: 'settingsError',
                message: formatError(error)
              });
            }
          );
          return;
        }

        if (message.type === 'rawContents') {
          void vscode.commands.executeCommand(
            'vscode.openWith',
            document.uri,
            'default',
            webviewPanel.viewColumn ?? vscode.ViewColumn.Active
          );
        }
      })
    );

    disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${SETTINGS_SECTION}.maxRows`) ||
          event.affectsConfiguration(`${SETTINGS_SECTION}.firstRowIsHeader`)
        ) {
          safeLoad();
          return;
        }

        if (
          event.affectsConfiguration(`${SETTINGS_SECTION}.wrapCellContents`)
        ) {
          currentSettings = getSettings();
          void webviewPanel.webview.postMessage({
            type: 'wrapCellContents',
            value: currentSettings.wrapCellContents
          });
        }
      })
    );

    disposables.push(
      vscode.workspace.onDidSaveTextDocument((textDocument) => {
        if (textDocument.uri.toString() === document.uri.toString()) {
          scheduleFileReload();
        }
      })
    );

    if (document.uri.scheme === 'file') {
      try {
        const directoryWatcher = nodeFs.watch(
          path.dirname(document.uri.fsPath),
          (_eventType, changedFileName) => {
            const changedName = changedFileName
              ? changedFileName.toString()
              : undefined;
            if (
              !changedName ||
              changedName === path.basename(document.uri.fsPath)
            ) {
              scheduleFileReload();
            }
          }
        );
        directoryWatcher.on('error', () => {
          // Save events still cover VS Code edits when native directory watching fails.
        });
        disposables.push({
          dispose: () => {
            directoryWatcher.close();
          }
        });
      } catch {
        // Some filesystems do not support native watching; save events still reload VS Code edits.
      }
    }

    webviewPanel.onDidDispose(() => {
      cancelCurrentWork();
      currentFileSnapshot = undefined;
      abortExactShape();
      if (fileReloadTimer) {
        clearTimeout(fileReloadTimer);
      }
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });

    safeLoad();
  }
}

async function postCsvData(
  uri: vscode.Uri,
  webview: vscode.Webview,
  generation: number,
  getLatestGeneration: () => number,
  signal: AbortSignal,
  settings: ViewerSettings,
  setFullIndex: (index: CsvRecordIndex) => void,
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

    if (shouldStartExactShape(preview)) {
      exactShapes.ensureExactShape(snapshot);
    }
  } catch (error) {
    if (generation !== getLatestGeneration()) {
      return;
    }

    if (isAbortError(error)) {
      await webview.postMessage({ type: 'fullIndexCancelled' });
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

function startExactShapeScan(
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

function getSettings(): ViewerSettings {
  const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return normalizeViewerSettings({
    maxRows: configuration.get('maxRows'),
    firstRowIsHeader: configuration.get('firstRowIsHeader'),
    wrapCellContents: configuration.get('wrapCellContents')
  });
}

function clampMessageInteger(
  value: unknown,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

interface CsvDataPayload {
  readonly fileName: string;
  readonly fileSize: string;
  readonly lastModified: string;
  readonly maxRows: number;
  readonly firstRowIsHeader: boolean;
  readonly wrapCellContents: boolean;
  readonly shape: CsvShape | null;
  readonly preview: CsvPreview;
}

interface FileSnapshot {
  readonly size: number;
  readonly mtimeMs: number;
}

interface ExactShapeCache {
  readonly snapshot: FileSnapshot;
  readonly recordCount: number;
  readonly columnCount: number;
}

interface ExactShapeRequest {
  readonly snapshot: FileSnapshot;
  readonly controller: AbortController;
}

interface ExactShapeCoordinator {
  readonly noteFileSnapshot: (snapshot: FileSnapshot) => void;
  readonly getCachedShape: (
    snapshot: FileSnapshot,
    firstRowIsHeader: boolean
  ) => CsvShape | undefined;
  readonly setCachedShape: (snapshot: FileSnapshot, shape: CsvShape) => void;
  readonly ensureExactShape: (snapshot: FileSnapshot) => void;
}

interface WebviewMessage {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly start?: unknown;
  readonly count?: unknown;
  readonly value?: unknown;
}

function getFileSnapshot(
  stats: Pick<nodeFs.Stats, 'size' | 'mtimeMs'>
): FileSnapshot {
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

function isSameFileSnapshot(left: FileSnapshot, right: FileSnapshot): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getHtml(fileName: string): string {
  const nonce = getNonce();
  const escapedTitle = escapeHtml(fileName);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
    }

    .info-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .info-item:not(:first-child)::before {
      content: "|";
      color: var(--vscode-descriptionForeground);
      margin-right: 4px;
      user-select: none;
    }

    .info strong {
      color: var(--vscode-editor-foreground);
      font-weight: 600;
    }

    .rows-control,
    .toggle-control {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .toggle-control input {
      margin: 0;
    }

    .rows-input {
      appearance: textfield;
      -moz-appearance: textfield;
      width: 72px;
      min-width: 0;
      border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
      border-radius: 3px;
      padding: 2px 6px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }

    .rows-input::-webkit-inner-spin-button,
    .rows-input::-webkit-outer-spin-button {
      margin: 0;
      -webkit-appearance: none;
    }

    .rows-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .rows-input.invalid {
      border-color: var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-input-background));
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-input-foreground));
    }

    .rows-input:disabled {
      opacity: 0.55;
    }

    .rows-error {
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      flex-wrap: wrap;
    }

    button {
      min-width: 86px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 4px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .mode-tabs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .mode-button {
      min-width: auto;
      border: 0;
      padding: 4px 9px;
      color: var(--vscode-foreground);
      background: transparent;
    }

    .mode-button:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground));
    }

    .mode-button[aria-pressed="true"] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .mode-button.raw-action {
      border-left: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 0 2px 2px 0;
    }

    main {
      padding: 12px;
    }

    .status,
    .error-panel {
      margin: 0 0 12px;
      color: var(--vscode-descriptionForeground);
    }

    .error-panel {
      padding: 10px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }

    .progress-panel {
      display: grid;
      gap: 10px;
      max-width: 720px;
      padding: 12px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .progress-track {
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--vscode-progressBar-background, var(--vscode-editorWidget-border));
    }

    .progress-bar {
      width: 0%;
      height: 100%;
      background: var(--vscode-button-background);
      transition: width 120ms linear;
    }

    .progress-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      color: var(--vscode-descriptionForeground);
    }

    .table-scroll {
      height: calc(100vh - 78px);
      min-height: 240px;
      overflow: auto;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
      --column-template: 58px;
    }

    .csv-table {
      min-width: var(--table-min-width, 100%);
    }

    .table-header,
    .width-control-row,
    .table-row {
      display: grid;
      grid-template-columns: var(--column-template);
    }

    .table-header,
    .width-control-row {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      box-shadow: 0 1px 0 var(--vscode-editorWidget-border, var(--vscode-panel-border));
    }

    .table-body {
      position: relative;
    }

    .table-cell {
      min-height: 30px;
      min-width: 0;
      padding: 6px 8px;
      border-right: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.35;
    }

    .cell-content {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: inherit;
    }

    .wrap-cells .table-cell:not(.index-cell) {
      overflow-wrap: anywhere;
      text-overflow: clip;
      white-space: pre-wrap;
    }

    .wrap-cells .cell-content {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .index-cell {
      position: sticky;
      left: 0;
      z-index: 1;
      color: var(--vscode-editorLineNumber-foreground);
      background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
      text-align: right;
      user-select: none;
      white-space: nowrap;
    }

    .table-header .table-cell,
    .width-control-row .table-cell {
      color: var(--vscode-editor-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      font-family: var(--vscode-font-family);
      font-weight: 600;
    }

    .width-control-row .table-cell {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .table-header .index-cell,
    .width-control-row .index-cell {
      z-index: 3;
    }

    .resizable-cell {
      position: relative;
      padding-right: 16px;
    }

    .column-resize-handle {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 8px;
      cursor: col-resize;
      touch-action: none;
    }

    .column-resize-handle::after {
      position: absolute;
      top: 6px;
      right: 3px;
      bottom: 6px;
      width: 1px;
      background: var(--vscode-editorWidget-border, var(--vscode-panel-border));
      content: "";
    }

    .column-resize-handle:hover::after,
    .column-resize-handle:focus::after {
      width: 2px;
      background: var(--vscode-focusBorder);
    }

    body.is-resizing,
    body.is-resizing * {
      cursor: col-resize !important;
      user-select: none !important;
    }

    .table-row:nth-child(even) .table-cell {
      background: var(--vscode-list-hoverBackground, transparent);
    }

    .table-row:nth-child(even) .index-cell {
      background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
    }

    .virtual-spacer {
      position: relative;
      min-height: 100%;
    }

    .virtual-rows {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      will-change: transform;
    }

    @media (max-width: 640px) {
      .topbar {
        align-items: stretch;
        flex-direction: column;
      }

      .actions,
      .mode-tabs {
        width: 100%;
      }

      .mode-button {
        flex: 1 1 auto;
      }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="info" aria-live="polite">
      <span class="info-item"><strong>Size:</strong> <span id="file-size">Loading...</span></span>
      <span class="info-item"><strong>Shape:</strong> <span id="csv-shape">Counting...</span></span>
      <label class="rows-control info-item"><strong>Show</strong> <input id="rows-input" class="rows-input" type="number" min="0" step="1" inputmode="numeric" aria-describedby="rows-error"> <span>rows</span></label>
      <label class="toggle-control info-item"><input id="wrap-toggle" type="checkbox" checked> <strong>Wrap cells</strong></label>
      <label class="toggle-control info-item"><input id="header-toggle" type="checkbox" checked> <strong>Header row</strong></label>
      <span id="rows-error" class="rows-error" role="status"></span>
      <span class="info-item"><strong>Modified:</strong> <span id="modified">Loading...</span></span>
      <span id="preview-status"></span>
    </div>
    <div class="actions">
      <div class="mode-tabs" role="toolbar" aria-label="CSV view mode">
        <button class="mode-button" type="button" id="quick-view" aria-pressed="true">Quick view</button>
        <button class="mode-button raw-action" type="button" id="raw-contents" aria-pressed="false">View raw</button>
      </div>
    </div>
  </header>
  <main id="content" tabindex="-1">
    <p class="status">Loading CSV preview...</p>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const content = document.getElementById('content');
    const quickViewButton = document.getElementById('quick-view');
    const rawContentsButton = document.getElementById('raw-contents');
    const fileSize = document.getElementById('file-size');
    const csvShape = document.getElementById('csv-shape');
    const rowsInput = document.getElementById('rows-input');
    const wrapToggle = document.getElementById('wrap-toggle');
    const headerToggle = document.getElementById('header-toggle');
    const rowsError = document.getElementById('rows-error');
    const modified = document.getElementById('modified');
    const previewStatus = document.getElementById('preview-status');

    const OVERSCAN = 10;
    const ROW_HEIGHT = 31;
    const LIMITED_VIRTUAL_THRESHOLD = ${INDEXED_PREVIEW_ROW_THRESHOLD};
    const MAX_VIRTUAL_SCROLL_HEIGHT = 8000000;
    const MAX_MEASURED_ROW_HEIGHTS = 512;
    const INDEX_COLUMN_WIDTH = 58;
    const MIN_AUTO_COLUMN_WIDTH = 80;
    const DEFAULT_AUTO_COLUMN_WIDTH = 140;
    const MAX_AUTO_COLUMN_WIDTH = 280;
    const COLUMN_WIDTH_CHAR_PX = 8;
    const COLUMN_WIDTH_PADDING_PX = 24;
    const MIN_MANUAL_COLUMN_WIDTH = 48;
    const MAX_MANUAL_COLUMN_WIDTH = 900;

    let viewState = 'loading';
    let data = null;
    let full = null;
    let fullProgress = null;
    let previewLoad = null;
    let previewProgress = null;
    let virtualScroll = null;
    let virtualSpacer = null;
    let virtualRows = null;
    let latestRequestId = 0;
    let pendingRequestId = '';
    let animationFrame = 0;
    let columnResizeFrame = 0;
    let lastSubmittedMaxRows = '';
    let measuredRowHeights = new Map();
    let currentVirtualStart = 0;
    let currentVirtualTotalRows = 0;
    let manualColumnWidths = new Map();
    let columnWidthCount = 0;
    let activeColumnResize = null;

    content.focus({ preventScroll: true });

    quickViewButton.addEventListener('click', () => {
      quickViewButton.setAttribute('aria-pressed', 'true');
      rawContentsButton.setAttribute('aria-pressed', 'false');
    });

    rawContentsButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'rawContents' });
    });

    rowsInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitMaxRows();
      }
    });

    rowsInput.addEventListener('blur', () => {
      submitMaxRows();
    });

    rowsInput.addEventListener('input', () => {
      clearRowsError();
    });

    wrapToggle.addEventListener('change', () => {
      const value = wrapToggle.checked;
      applyWrapCellContents(value);
      vscode.postMessage({
        type: 'updateWrapCellContents',
        value
      });
    });

    headerToggle.addEventListener('change', () => {
      vscode.postMessage({
        type: 'updateFirstRowIsHeader',
        value: headerToggle.checked
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.type === 'loading') {
        viewState = 'loading';
        data = null;
        full = null;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        renderLoading();
        return;
      }

      if (message.type === 'data') {
        viewState = 'limited';
        data = withShapeState(message.payload);
        full = null;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        renderLimited();
        return;
      }

      if (message.type === 'shape') {
        if (data) {
          data.shape = message.shape;
          data.shapeState = 'ready';
          data.shapeProgress = null;
          renderLimited();
          return;
        }

        if (full) {
          full.shape = message.shape;
          full.shapeState = 'ready';
          full.shapeProgress = null;
          renderFullViewer();
          return;
        }

        setShapeText('ready', message.shape, null);
        return;
      }

      if (message.type === 'shapeProgress') {
        const progress = normalizeShapeProgress(message.payload);
        if (data) {
          data.shapeState = 'counting';
          data.shapeProgress = progress;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.shapeState = 'counting';
          full.shapeProgress = progress;
          renderFullInfo();
          return;
        }

        setShapeText('counting', null, progress);
        return;
      }

      if (message.type === 'shapeError') {
        if (data) {
          data.shapeState = 'unavailable';
          data.shapeProgress = null;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.shapeState = 'unavailable';
          full.shapeProgress = null;
          renderFullInfo();
          return;
        }

        setShapeText('unavailable', null, null);
        return;
      }

      if (message.type === 'maxRowsError') {
        showRowsError(message.message || 'Rows must be 0 or a positive whole number.');
        return;
      }

      if (message.type === 'settingsError') {
        previewStatus.textContent = message.message || 'Unable to update settings.';
        renderCurrentSettings();
        return;
      }

      if (message.type === 'wrapCellContents') {
        applyWrapCellContents(Boolean(message.value));
        return;
      }

      if (message.type === 'previewLoadStart') {
        viewState = 'previewLoading';
        data = null;
        full = null;
        previewLoad = message.payload;
        previewProgress = {
          loadedRowCount: 0,
          displayLimit: message.payload.displayLimit,
          percent: 0
        };
        resetColumnWidths();
        renderPreviewLoading();
        return;
      }

      if (message.type === 'previewLoadProgress') {
        previewProgress = message.payload;
        if (viewState === 'previewLoading') {
          renderPreviewLoading();
        }
        return;
      }

      if (message.type === 'fullIndexStart') {
        viewState = 'fullIndexing';
        data = null;
        full = message.payload;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        fullProgress = {
          bytesRead: 0,
          totalBytes: message.payload.totalBytes,
          percent: 0,
          indexedRecordCount: 0,
          columnCount: 0
        };
        renderFullIndexing();
        return;
      }

      if (message.type === 'fullIndexProgress') {
        fullProgress = message.payload;
        if (viewState === 'fullIndexing') {
          renderFullIndexing();
        }
        return;
      }

      if (message.type === 'fullIndexReady') {
        viewState = 'fullReady';
        full = withShapeState(message.payload);
        fullProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        renderFullViewer();
        return;
      }

      if (message.type === 'fullIndexCancelled') {
        viewState = 'cancelled';
        renderCancelled();
        return;
      }

      if (message.type === 'rows') {
        if (message.requestId !== pendingRequestId || viewState !== 'fullReady') {
          return;
        }

        renderVirtualRows(message.payload.start, message.payload.rows, message.payload.totalRows);
        return;
      }

      if (message.type === 'error') {
        data = null;
        full = null;
        viewState = 'error';
        renderError(message.message);
      }
    });

    function renderLoading() {
      setControlsDisabled(true);
      fileSize.textContent = 'Loading...';
      csvShape.textContent = 'Counting...';
      rowsInput.value = '';
      lastSubmittedMaxRows = '';
      wrapToggle.checked = true;
      headerToggle.checked = true;
      modified.textContent = 'Loading...';
      previewStatus.textContent = '';
      clearRowsError();
      content.replaceChildren(status('Loading CSV preview...'));
    }

    function renderError(message) {
      setControlsDisabled(true);
      fileSize.textContent = 'Unavailable';
      csvShape.textContent = 'Unavailable';
      rowsInput.value = '';
      lastSubmittedMaxRows = '';
      wrapToggle.checked = true;
      headerToggle.checked = true;
      modified.textContent = 'Unavailable';
      previewStatus.textContent = '';
      clearRowsError();
      const panel = document.createElement('div');
      panel.className = 'error-panel';
      panel.textContent = message || 'Unable to load CSV file.';
      content.replaceChildren(panel);
    }

    function renderCancelled() {
      setControlsDisabled(true);
      previewStatus.textContent = 'Loading cancelled';
      content.replaceChildren(status('Loading was cancelled. Change settings or reopen the file to start again.'));
    }

    function renderPreviewLoading() {
      if (!previewLoad || !previewProgress) {
        renderLoading();
        return;
      }

      setControlsDisabled(true);
      fileSize.textContent = previewLoad.fileSize;
      csvShape.textContent = 'Counting...';
      rowsInput.value = String(previewLoad.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(previewLoad);
      modified.textContent = previewLoad.lastModified;
      previewStatus.textContent = 'Loading preview ' + formatPercent(previewProgress.percent);

      const panel = document.createElement('section');
      panel.className = 'progress-panel';

      const title = document.createElement('p');
      title.className = 'status';
      title.textContent = 'Loading preview...';

      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = Math.max(0, Math.min(100, previewProgress.percent)) + '%';
      track.append(bar);

      const meta = document.createElement('div');
      meta.className = 'progress-meta';
      meta.append(
        textSpan(formatInteger(previewProgress.loadedRowCount) + ' / ' + formatInteger(previewProgress.displayLimit) + ' rows loaded')
      );

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelIndex' });
      });

      panel.append(title, track, meta, cancel);
      content.replaceChildren(panel);
    }

    function renderLimited() {
      if (!data) {
        renderLoading();
        return;
      }

      setControlsDisabled(false);
      renderLimitedInfo();

      if (data.preview.rows.length >= LIMITED_VIRTUAL_THRESHOLD) {
        renderLimitedVirtualViewer();
        return;
      }

      const columnCount = getPayloadColumnCount(data);
      if (columnCount === 0) {
        content.replaceChildren(status('No rows loaded from this CSV file.'));
        return;
      }

      const shell = createTableShell(data, columnCount);
      for (const row of data.preview.rows) {
        shell.body.append(renderTableRow(row, columnCount, false, 0));
      }

      if (data.preview.rows.length === 0) {
        const fragment = document.createDocumentFragment();
        fragment.append(shell.scroll, status('No data rows loaded from this CSV file.'));
        content.replaceChildren(fragment);
        return;
      }

      content.replaceChildren(shell.scroll);
    }

    function renderLimitedVirtualViewer() {
      if (!data) {
        renderLoading();
        return;
      }

      viewState = 'limitedVirtual';
      const columnCount = getPayloadColumnCount(data);
      const shell = createTableShell(data, columnCount);
      virtualScroll = shell.scroll;
      virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

      virtualSpacer = document.createElement('div');
      virtualSpacer.className = 'virtual-spacer';
      virtualSpacer.style.height = String(getVirtualSpacerHeight(data.preview.rows.length)) + 'px';

      virtualRows = document.createElement('div');
      virtualRows.className = 'virtual-rows';
      virtualSpacer.append(virtualRows);
      shell.body.replaceChildren(virtualSpacer);
      content.replaceChildren(shell.scroll);

      requestLimitedVisibleRows();
    }

    function renderLimitedInfo() {
      fileSize.textContent = data.fileSize;
      setShapeText(data.shapeState, data.shape, data.shapeProgress);
      rowsInput.value = String(data.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(data);
      modified.textContent = data.lastModified;

      const loaded = data.preview.loadedRowCount;
      const limit = data.maxRows;
      if (loaded >= limit) {
        previewStatus.textContent = 'Showing first ' + formatInteger(loaded) + ' rows';
      } else {
        previewStatus.textContent = 'Showing ' + formatInteger(loaded) + ' loaded rows';
      }
    }

    function renderFullIndexing() {
      if (!full || !fullProgress) {
        renderLoading();
        return;
      }

      setControlsDisabled(true);
      fileSize.textContent = full.fileSize;
      csvShape.textContent = 'Indexing...';
      rowsInput.value = String(full.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(full);
      modified.textContent = full.lastModified;
      const indexingLabel = full.maxRows === 0 ? 'Indexing full file' : 'Preparing indexed preview';
      previewStatus.textContent = indexingLabel + ' ' + formatPercent(fullProgress.percent);

      const panel = document.createElement('section');
      panel.className = 'progress-panel';

      const title = document.createElement('p');
      title.className = 'status';
      title.textContent = indexingLabel + '...';

      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = Math.max(0, Math.min(100, fullProgress.percent)) + '%';
      track.append(bar);

      const meta = document.createElement('div');
      meta.className = 'progress-meta';
      meta.append(
        textSpan(formatPercent(fullProgress.percent)),
        textSpan(formatBytes(fullProgress.bytesRead) + ' / ' + formatBytes(fullProgress.totalBytes)),
        textSpan(formatInteger(fullProgress.indexedRecordCount) + ' records found')
      );

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelIndex' });
      });

      panel.append(title, track, meta, cancel);
      content.replaceChildren(panel);
    }

    function renderFullViewer() {
      if (!full) {
        renderLoading();
        return;
      }

      setControlsDisabled(false);
      renderFullInfo();

      const columnCount = getPayloadColumnCount(full);
      if (columnCount === 0) {
        content.replaceChildren(status('No rows loaded from this CSV file.'));
        return;
      }

      const shell = createTableShell(full, columnCount);
      virtualScroll = shell.scroll;
      virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

      virtualSpacer = document.createElement('div');
      virtualSpacer.className = 'virtual-spacer';
      virtualSpacer.style.height = String(getVirtualSpacerHeight(full.totalRows)) + 'px';

      virtualRows = document.createElement('div');
      virtualRows.className = 'virtual-rows';
      virtualSpacer.append(virtualRows);
      shell.body.replaceChildren(virtualSpacer);
      content.replaceChildren(shell.scroll);

      requestVisibleRows();
    }

    function renderFullInfo() {
      if (!full) {
        return;
      }

      fileSize.textContent = full.fileSize;
      setShapeText(full.shapeState, full.shape, full.shapeProgress);
      rowsInput.value = String(full.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(full);
      modified.textContent = full.lastModified;

      if (full.maxRows === 0) {
        previewStatus.textContent = 'Virtual full-file view';
        return;
      }

      if (!full.shape) {
        previewStatus.textContent = 'Showing first ' + formatInteger(full.totalRows) + ' rows';
        return;
      }

      if (full.totalRows >= full.shape.rowCount) {
        previewStatus.textContent = 'Showing all ' + formatInteger(full.shape.rowCount) + ' rows';
        return;
      }

      previewStatus.textContent =
        'Showing first ' + formatInteger(full.totalRows) + ' of ' + formatInteger(full.shape.rowCount) + ' rows';
    }

    function withShapeState(payload) {
      return {
        ...payload,
        shapeState: payload.shape === null ? 'counting' : 'ready',
        shapeProgress: null
      };
    }

    function setShapeText(state, value, progress) {
      if (state === 'unavailable') {
        csvShape.textContent = 'Unavailable';
        return;
      }

      if (state === 'ready' && value) {
        csvShape.textContent =
          formatInteger(value.rowCount) + ' rows x ' + formatInteger(value.columnCount) + ' columns';
        return;
      }

      csvShape.textContent = progress ? 'Counting ' + formatPercent(progress.percent) : 'Counting...';
    }

    function normalizeShapeProgress(payload) {
      if (!payload || typeof payload.percent !== 'number' || !Number.isFinite(payload.percent)) {
        return null;
      }

      return {
        percent: payload.percent,
        rowCount: typeof payload.rowCount === 'number' ? payload.rowCount : null,
        columnCount: typeof payload.columnCount === 'number' ? payload.columnCount : null
      };
    }

    function renderCurrentSettings() {
      const payload = data || full || previewLoad;
      if (payload) {
        renderSettingsControls(payload);
      }
    }

    function renderSettingsControls(payload) {
      wrapToggle.checked = Boolean(payload.wrapCellContents);
      headerToggle.checked = Boolean(payload.firstRowIsHeader);
    }

    function applyWrapCellContents(value) {
      if (data) {
        data.wrapCellContents = value;
      }

      if (full) {
        full.wrapCellContents = value;
      }

      if (previewLoad) {
        previewLoad.wrapCellContents = value;
      }

      wrapToggle.checked = value;
      resetVirtualMeasurements();

      if (viewState === 'limited' || viewState === 'limitedVirtual') {
        renderLimited();
        return;
      }

      if (viewState === 'fullReady') {
        renderFullViewer();
      }
    }

    function scheduleVisibleRowsRequest() {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        if (viewState === 'limitedVirtual') {
          requestLimitedVisibleRows();
          return;
        }

        requestVisibleRows();
      });
    }

    function requestVisibleRows() {
      if (!full || !virtualScroll) {
        return;
      }

      const viewport = getBodyViewport();
      const logicalScrollTop = scrollToLogicalOffset(
        viewport.scrollTop,
        full.totalRows,
        viewport.height
      );
      const logicalScrollBottom = getLogicalViewportBottom(
        logicalScrollTop,
        full.totalRows,
        viewport.height
      );
      const start = Math.max(0, getIndexAtScrollOffset(logicalScrollTop, full.totalRows) - OVERSCAN);
      const end = Math.min(
        full.totalRows,
        getIndexAtScrollOffset(logicalScrollBottom, full.totalRows) + OVERSCAN + 1
      );
      const count = Math.max(0, end - start);
      const requestId = 'rows-' + String(++latestRequestId);
      pendingRequestId = requestId;

      vscode.postMessage({
        type: 'fetchRows',
        requestId,
        start,
        count
      });
    }

    function requestLimitedVisibleRows() {
      if (!data || !virtualScroll) {
        return;
      }

      const totalRows = data.preview.rows.length;
      const viewport = getBodyViewport();
      const logicalScrollTop = scrollToLogicalOffset(
        viewport.scrollTop,
        totalRows,
        viewport.height
      );
      const logicalScrollBottom = getLogicalViewportBottom(
        logicalScrollTop,
        totalRows,
        viewport.height
      );
      const start = Math.max(0, getIndexAtScrollOffset(logicalScrollTop, totalRows) - OVERSCAN);
      const end = Math.min(
        totalRows,
        getIndexAtScrollOffset(logicalScrollBottom, totalRows) + OVERSCAN + 1
      );
      const count = Math.max(0, end - start);
      renderLimitedVirtualRows(start, count);
    }

    function renderLimitedVirtualRows(start, count) {
      if (!virtualRows || !virtualSpacer || !data) {
        return;
      }

      const totalRows = data.preview.rows.length;
      const columnCount = getPayloadColumnCount(data);
      const viewport = getBodyViewport();
      currentVirtualStart = start;
      currentVirtualTotalRows = totalRows;
      pruneMeasuredRowHeights(start, count);
      virtualSpacer.style.height = String(getVirtualSpacerHeight(totalRows)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(logicalToPhysicalOffset(getVirtualOffset(start), totalRows, viewport.height)) +
        'px)';

      const fragment = document.createDocumentFragment();
      for (let index = start; index < start + count; index += 1) {
        const row = data.preview.rows[index];
        if (row) {
          fragment.append(renderTableRow(row, columnCount, true, index));
        }
      }
      virtualRows.replaceChildren(fragment);
      measureRenderedRows();
    }

    function renderVirtualRows(start, rows, totalRows) {
      if (!virtualRows || !virtualSpacer || !full) {
        return;
      }

      full.totalRows = totalRows;
      full.visibleRows = rows;
      const columnCount = getPayloadColumnCount(full);
      applyCurrentColumnTemplate();
      const viewport = getBodyViewport();
      currentVirtualStart = start;
      currentVirtualTotalRows = totalRows;
      pruneMeasuredRowHeights(start, rows.length);
      virtualSpacer.style.height = String(getVirtualSpacerHeight(totalRows)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(logicalToPhysicalOffset(getVirtualOffset(start), totalRows, viewport.height)) +
        'px)';

      const fragment = document.createDocumentFragment();
      for (let index = 0; index < rows.length; index += 1) {
        fragment.append(renderTableRow(rows[index], columnCount, true, start + index));
      }
      virtualRows.replaceChildren(fragment);
      measureRenderedRows();
    }

    function createTableShell(payload, columnCount) {
      ensureColumnWidthState(columnCount);

      const scroll = document.createElement('div');
      scroll.className = payload.wrapCellContents ? 'table-scroll wrap-cells' : 'table-scroll';
      applyColumnTemplate(scroll, getColumnWidths(payload, columnCount));

      const table = document.createElement('div');
      table.className = 'csv-table';
      table.setAttribute('role', 'table');

      const body = document.createElement('div');
      body.className = 'table-body';
      body.setAttribute('role', 'rowgroup');

      if (payload.firstRowIsHeader) {
        const header = document.createElement('div');
        header.className = 'table-header';
        header.setAttribute('role', 'row');
        header.append(createIndexCell('0', 'rowheader'));

        for (const [columnIndex, label] of getHeaders(payload, columnCount).entries()) {
          header.append(createHeaderCell(label, columnIndex));
        }

        table.append(header, body);
      } else {
        table.append(createWidthControlRow(columnCount), body);
      }

      scroll.append(table);
      return { scroll, body };
    }

    function renderTableRow(row, columnCount, virtualized, rowIndex) {
      const element = document.createElement('div');
      element.className = 'table-row';
      element.setAttribute('role', 'row');
      element.dataset.rowNumber = String(row.rowNumber);
      if (virtualized) {
        element.dataset.index = String(rowIndex);
      }

      element.append(createIndexCell(String(row.rowNumber), 'rowheader'));
      const cells = normalizeCells(row.cells, columnCount);
      for (const value of cells) {
        const cell = document.createElement('div');
        cell.className = 'table-cell';
        cell.setAttribute('role', 'cell');
        appendCellContent(cell, value);
        cell.title = value;
        element.append(cell);
      }

      return element;
    }

    function createHeaderCell(label, columnIndex) {
      const cell = document.createElement('div');
      cell.className = 'table-cell resizable-cell';
      cell.setAttribute('role', 'columnheader');
      appendCellContent(cell, label);
      cell.title = label;
      cell.append(createColumnResizeHandle(columnIndex));
      return cell;
    }

    function createWidthControlRow(columnCount) {
      const row = document.createElement('div');
      row.className = 'width-control-row';
      row.setAttribute('role', 'row');
      row.append(createIndexCell('', 'presentation'));

      for (const [columnIndex, label] of normalizeHeaders([], columnCount).entries()) {
        row.append(createHeaderCell(label, columnIndex));
      }

      return row;
    }

    function appendCellContent(cell, value) {
      const content = document.createElement('span');
      content.className = 'cell-content';
      content.textContent = value;
      cell.append(content);
    }

    function createIndexCell(value, role) {
      const cell = document.createElement('div');
      cell.className = 'table-cell index-cell';
      cell.setAttribute('role', role);
      cell.textContent = value;
      cell.title = value;
      return cell;
    }

    function getPayloadColumnCount(payload) {
      if (payload.shape && typeof payload.shape.columnCount === 'number') {
        return payload.shape.columnCount;
      }

      if (payload.preview && typeof payload.preview.columnCount === 'number') {
        return payload.preview.columnCount;
      }

      return typeof payload.columnCount === 'number' ? payload.columnCount : 0;
    }

    function getHeaders(payload, columnCount) {
      return normalizeHeaders(payload.headerFields || payload.preview?.headerFields || [], columnCount);
    }

    function normalizeHeaders(headerFields, columnCount) {
      const headers = [];
      for (let index = 0; index < columnCount; index += 1) {
        const value = headerFields[index];
        headers.push(value && value.trim() !== '' ? value : 'Column ' + String(index + 1));
      }
      return headers;
    }

    function normalizeCells(cells, columnCount) {
      const normalized = [];
      for (let index = 0; index < columnCount; index += 1) {
        normalized.push(cells[index] || '');
      }
      return normalized;
    }

    function ensureColumnWidthState(columnCount) {
      if (columnWidthCount === columnCount) {
        return;
      }

      manualColumnWidths = new Map();
      columnWidthCount = columnCount;
      activeColumnResize = null;
      document.body.classList.remove('is-resizing');
    }

    function resetColumnWidths() {
      manualColumnWidths = new Map();
      columnWidthCount = 0;
      activeColumnResize = null;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', handleColumnResize);
      window.removeEventListener('pointerup', stopColumnResize);
      window.removeEventListener('pointercancel', stopColumnResize);
      if (columnResizeFrame) {
        cancelAnimationFrame(columnResizeFrame);
        columnResizeFrame = 0;
      }
    }

    function getColumnWidths(payload, columnCount) {
      const autoWidths = getAutoColumnWidths(payload, columnCount);
      return autoWidths.map((width, index) => manualColumnWidths.get(index) || width);
    }

    function getAutoColumnWidths(payload, columnCount) {
      const widths = new Array(columnCount).fill(MIN_AUTO_COLUMN_WIDTH);
      const includeValue = (columnIndex, value) => {
        if (columnIndex < 0 || columnIndex >= columnCount) {
          return;
        }

        widths[columnIndex] = Math.max(widths[columnIndex], estimateColumnWidth(value));
      };

      if (payload.firstRowIsHeader) {
        for (const [columnIndex, header] of getHeaders(payload, columnCount).entries()) {
          includeValue(columnIndex, header);
        }
      }

      const autosizeRows = payload.preview ? payload.preview.rows : payload.visibleRows || [];
      for (const row of autosizeRows) {
        const cells = normalizeCells(row.cells || [], columnCount);
        for (const [columnIndex, value] of cells.entries()) {
          includeValue(columnIndex, value);
        }
      }

      return widths.map((width) => clampAutoColumnWidth(width || DEFAULT_AUTO_COLUMN_WIDTH));
    }

    function estimateColumnWidth(value) {
      const text = value == null ? '' : String(value);
      const lines = text.split(/\\r\\n|\\r|\\n/);
      let longestLine = 0;
      for (const line of lines) {
        longestLine = Math.max(longestLine, Array.from(line).length);
      }

      return longestLine * COLUMN_WIDTH_CHAR_PX + COLUMN_WIDTH_PADDING_PX;
    }

    function clampAutoColumnWidth(value) {
      return Math.max(MIN_AUTO_COLUMN_WIDTH, Math.min(MAX_AUTO_COLUMN_WIDTH, Math.ceil(value)));
    }

    function clampManualColumnWidth(value) {
      return Math.max(MIN_MANUAL_COLUMN_WIDTH, Math.min(MAX_MANUAL_COLUMN_WIDTH, Math.ceil(value)));
    }

    function applyColumnTemplate(scroll, columnWidths) {
      const roundedWidths = columnWidths.map((width) => Math.max(1, Math.round(width)));
      const template = [INDEX_COLUMN_WIDTH, ...roundedWidths].map((width) => String(width) + 'px').join(' ');
      const totalWidth = roundedWidths.reduce((sum, width) => sum + width, INDEX_COLUMN_WIDTH);
      scroll.style.setProperty('--column-template', template);
      scroll.style.setProperty('--table-min-width', Math.max(INDEX_COLUMN_WIDTH, totalWidth) + 'px');
    }

    function applyCurrentColumnTemplate() {
      const payload = getCurrentTablePayload();
      if (!payload) {
        return;
      }

      const columnCount = getPayloadColumnCount(payload);
      ensureColumnWidthState(columnCount);
      const columnWidths = getColumnWidths(payload, columnCount);
      for (const scroll of document.querySelectorAll('.table-scroll')) {
        applyColumnTemplate(scroll, columnWidths);
      }
    }

    function getCurrentTablePayload() {
      return data || full;
    }

    function createColumnResizeHandle(columnIndex) {
      const handle = document.createElement('span');
      handle.className = 'column-resize-handle';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize column ' + String(columnIndex + 1));
      handle.tabIndex = 0;
      handle.addEventListener('pointerdown', (event) => {
        startColumnResize(event, columnIndex);
      });
      handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetManualColumnWidth(columnIndex);
      });
      handle.addEventListener('keydown', (event) => {
        resizeColumnFromKeyboard(event, columnIndex);
      });
      return handle;
    }

    function startColumnResize(event, columnIndex) {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      const payload = getCurrentTablePayload();
      if (!payload) {
        return;
      }

      const columnCount = getPayloadColumnCount(payload);
      ensureColumnWidthState(columnCount);
      const widths = getColumnWidths(payload, columnCount);
      activeColumnResize = {
        columnIndex,
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: widths[columnIndex] || DEFAULT_AUTO_COLUMN_WIDTH
      };
      document.body.classList.add('is-resizing');
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      window.addEventListener('pointermove', handleColumnResize);
      window.addEventListener('pointerup', stopColumnResize, { once: true });
      window.addEventListener('pointercancel', stopColumnResize, { once: true });
    }

    function handleColumnResize(event) {
      if (!activeColumnResize || event.pointerId !== activeColumnResize.pointerId) {
        return;
      }

      const nextWidth = clampManualColumnWidth(
        activeColumnResize.startWidth + event.clientX - activeColumnResize.startX
      );
      manualColumnWidths.set(activeColumnResize.columnIndex, nextWidth);
      applyCurrentColumnTemplate();
      scheduleRenderedRowMeasurement();
    }

    function stopColumnResize() {
      if (!activeColumnResize) {
        return;
      }

      activeColumnResize = null;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', handleColumnResize);
      window.removeEventListener('pointerup', stopColumnResize);
      window.removeEventListener('pointercancel', stopColumnResize);
      refreshVisibleRowsAfterColumnWidthChange();
    }

    function resetManualColumnWidth(columnIndex) {
      manualColumnWidths.delete(columnIndex);
      applyCurrentColumnTemplate();
      refreshVisibleRowsAfterColumnWidthChange();
    }

    function resizeColumnFromKeyboard(event, columnIndex) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }

      const payload = getCurrentTablePayload();
      if (!payload) {
        return;
      }

      const columnCount = getPayloadColumnCount(payload);
      const widths = getColumnWidths(payload, columnCount);
      const delta = event.key === 'ArrowRight' ? 16 : -16;
      manualColumnWidths.set(
        columnIndex,
        clampManualColumnWidth((widths[columnIndex] || DEFAULT_AUTO_COLUMN_WIDTH) + delta)
      );
      event.preventDefault();
      event.stopPropagation();
      applyCurrentColumnTemplate();
      refreshVisibleRowsAfterColumnWidthChange();
    }

    function scheduleRenderedRowMeasurement() {
      if (columnResizeFrame) {
        cancelAnimationFrame(columnResizeFrame);
      }

      columnResizeFrame = requestAnimationFrame(() => {
        columnResizeFrame = 0;
        measureRenderedRows();
      });
    }

    function refreshVisibleRowsAfterColumnWidthChange() {
      resetVirtualMeasurements();
      if (viewState === 'limitedVirtual') {
        requestLimitedVisibleRows();
        return;
      }

      if (viewState === 'fullReady') {
        requestVisibleRows();
        return;
      }

      measureRenderedRows();
    }

    function getBodyViewport() {
      const header = virtualScroll ? virtualScroll.querySelector('.table-header, .width-control-row') : null;
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      return {
        scrollTop: Math.max(0, virtualScroll.scrollTop - headerHeight),
        height: Math.max(1, virtualScroll.clientHeight - headerHeight)
      };
    }

    function getEstimatedRowHeight() {
      return ROW_HEIGHT;
    }

    function getVirtualTotalHeight(totalRows) {
      const estimatedRowHeight = getEstimatedRowHeight();
      let total = totalRows * estimatedRowHeight;
      for (const [index, height] of measuredRowHeights) {
        if (index >= 0 && index < totalRows) {
          total += height - estimatedRowHeight;
        }
      }

      return Math.max(0, total);
    }

    function getVirtualSpacerHeight(totalRows) {
      return Math.min(getVirtualTotalHeight(totalRows), MAX_VIRTUAL_SCROLL_HEIGHT);
    }

    function scrollToLogicalOffset(scrollOffset, totalRows, viewportHeight) {
      const logicalHeight = getVirtualTotalHeight(totalRows);
      const physicalHeight = getVirtualSpacerHeight(totalRows);
      const logicalMax = Math.max(0, logicalHeight - viewportHeight);
      const physicalMax = Math.max(0, physicalHeight - viewportHeight);

      if (logicalMax === 0 || physicalMax === 0) {
        return Math.max(0, Math.min(logicalHeight, scrollOffset));
      }

      return Math.max(0, Math.min(logicalMax, (scrollOffset / physicalMax) * logicalMax));
    }

    function getLogicalViewportBottom(logicalScrollTop, totalRows, viewportHeight) {
      return Math.max(
        0,
        Math.min(getVirtualTotalHeight(totalRows), logicalScrollTop + viewportHeight)
      );
    }

    function logicalToPhysicalOffset(logicalOffset, totalRows, viewportHeight) {
      const logicalHeight = getVirtualTotalHeight(totalRows);
      const physicalHeight = getVirtualSpacerHeight(totalRows);
      const logicalMax = Math.max(0, logicalHeight - viewportHeight);
      const physicalMax = Math.max(0, physicalHeight - viewportHeight);

      if (logicalMax === 0 || physicalMax === 0 || physicalHeight === logicalHeight) {
        return logicalOffset;
      }

      return Math.max(0, Math.min(physicalMax, (logicalOffset / logicalMax) * physicalMax));
    }

    function getVirtualOffset(index) {
      const estimatedRowHeight = getEstimatedRowHeight();
      let offset = index * estimatedRowHeight;
      for (const [measuredIndex, height] of measuredRowHeights) {
        if (measuredIndex >= 0 && measuredIndex < index) {
          offset += height - estimatedRowHeight;
        }
      }

      return Math.max(0, offset);
    }

    function getIndexAtScrollOffset(scrollOffset, totalRows) {
      if (totalRows <= 0) {
        return 0;
      }

      let low = 0;
      let high = totalRows - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const nextOffset = getVirtualOffset(middle + 1);
        if (nextOffset <= scrollOffset) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      return low;
    }

    function measureRenderedRows() {
      if (!virtualRows || !virtualSpacer || !virtualScroll) {
        return;
      }

      let changed = false;
      for (const row of virtualRows.children) {
        const index = Number(row.dataset.index);
        if (!Number.isInteger(index)) {
          continue;
        }

        const measuredHeight = row.getBoundingClientRect().height;
        const previousHeight = measuredRowHeights.get(index);
        if (!previousHeight || Math.abs(previousHeight - measuredHeight) > 1) {
          measuredRowHeights.set(index, measuredHeight);
          changed = true;
        }
      }

      pruneMeasuredRowHeights(currentVirtualStart, virtualRows.children.length);

      if (!changed) {
        return;
      }

      const viewport = getBodyViewport();
      virtualSpacer.style.height = String(getVirtualSpacerHeight(currentVirtualTotalRows)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(
          logicalToPhysicalOffset(
            getVirtualOffset(currentVirtualStart),
            currentVirtualTotalRows,
            viewport.height
          )
        ) +
        'px)';
    }

    function resetVirtualMeasurements() {
      measuredRowHeights = new Map();
      currentVirtualStart = 0;
      currentVirtualTotalRows = 0;
    }

    function pruneMeasuredRowHeights(start, count) {
      if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
        return;
      }

      const windowStart = Math.max(0, start - OVERSCAN * 4);
      const windowEnd = start + count + OVERSCAN * 4;
      for (const index of measuredRowHeights.keys()) {
        if (index < windowStart || index > windowEnd) {
          measuredRowHeights.delete(index);
        }
      }

      if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
        return;
      }

      for (const index of measuredRowHeights.keys()) {
        if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
          return;
        }

        measuredRowHeights.delete(index);
      }
    }

    function setControlsDisabled(disabled) {
      quickViewButton.disabled = disabled;
      rawContentsButton.disabled = disabled;
      rowsInput.disabled = disabled;
      wrapToggle.disabled = disabled;
      headerToggle.disabled = disabled;
      quickViewButton.setAttribute('aria-pressed', 'true');
      rawContentsButton.setAttribute('aria-pressed', 'false');
    }

    function submitMaxRows() {
      if (rowsInput.disabled) {
        return;
      }

      const rawValue = rowsInput.value.trim();
      if (rawValue === '') {
        showRowsError('Rows must be 0 or a positive whole number.');
        return;
      }

      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 0) {
        showRowsError('Rows must be 0 or a positive whole number.');
        return;
      }

      const nextValue = String(value);
      if (nextValue === lastSubmittedMaxRows) {
        return;
      }

      lastSubmittedMaxRows = nextValue;
      clearRowsError();
      vscode.postMessage({
        type: 'updateMaxRows',
        value
      });
    }

    function showRowsError(message) {
      rowsInput.classList.add('invalid');
      rowsError.textContent = message;
    }

    function clearRowsError() {
      rowsInput.classList.remove('invalid');
      rowsError.textContent = '';
    }

    function status(message) {
      const element = document.createElement('p');
      element.className = 'status';
      element.textContent = message;
      return element;
    }

    function textSpan(message) {
      const element = document.createElement('span');
      element.textContent = message;
      return element;
    }

    function formatPercent(value) {
      return Math.max(0, Math.min(100, value)).toFixed(1) + '%';
    }

    function formatBytes(bytes) {
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

      return unitIndex === 0 ? String(bytes) + ' B' : value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
    }

    function formatInteger(value) {
      if (!Number.isFinite(value)) {
        return String(value);
      }

      return Math.trunc(value).toLocaleString('en-US');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
