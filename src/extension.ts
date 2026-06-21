import * as nodeFs from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CsvPreview,
  CsvRecordIndex,
  CsvShape,
  CsvTableRow,
  DEFAULT_MAX_ROWS,
  ViewerSettings,
  fetchCsvHeaders,
  fetchCsvRows,
  formatFileSize,
  getDataRowCount,
  getDisplayRowCount,
  getRecordLimit,
  indexCsvFile,
  isAbortError,
  normalizeViewerSettings,
  readCsvPreview,
  scanCsvShape,
  shapeFromRecordScan,
  shouldUseIndexedPreview
} from './csv';
import { getHtml } from './extension/webview';

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
    let lastSuccessfulLoad: SuccessfulLoadState | undefined;
    let fileReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let suppressSettingsReload = false;
    let clearSuppressSettingsReloadTimer:
      | ReturnType<typeof setTimeout>
      | undefined;
    let currentFileSnapshot: FileSnapshot | undefined;
    let exactShapeCache: ExactShapeCache | undefined;
    let exactShapeRequest: ExactShapeRequest | undefined;

    const cancelCurrentWork = (): void => {
      abortController?.abort();
      abortController = undefined;
      fullIndex = undefined;
    };

    const runWithoutSettingsReload = async (
      operation: () => Thenable<void> | Promise<void>
    ): Promise<void> => {
      suppressSettingsReload = true;
      if (clearSuppressSettingsReloadTimer) {
        clearTimeout(clearSuppressSettingsReloadTimer);
        clearSuppressSettingsReloadTimer = undefined;
      }

      try {
        await operation();
      } finally {
        clearSuppressSettingsReloadTimer = setTimeout(() => {
          suppressSettingsReload = false;
          clearSuppressSettingsReloadTimer = undefined;
        }, 100);
      }
    };

    const updateSettingsWithoutReload = async (
      settings: Partial<Pick<ViewerSettings, 'maxRows' | 'firstRowIsHeader'>>
    ): Promise<void> => {
      const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION);
      const updates: Array<() => Thenable<void>> = [];
      const maxRows = settings.maxRows;
      const firstRowIsHeader = settings.firstRowIsHeader;

      if (typeof maxRows === 'number' && getSettings().maxRows !== maxRows) {
        updates.push(() =>
          configuration.update(
            'maxRows',
            maxRows,
            vscode.ConfigurationTarget.Global
          )
        );
      }

      if (
        typeof firstRowIsHeader === 'boolean' &&
        getSettings().firstRowIsHeader !== firstRowIsHeader
      ) {
        updates.push(() =>
          configuration.update(
            'firstRowIsHeader',
            firstRowIsHeader,
            vscode.ConfigurationTarget.Global
          )
        );
      }

      if (updates.length === 0) {
        currentSettings = {
          ...currentSettings,
          ...settings
        };
        return;
      }

      await runWithoutSettingsReload(async () => {
        await Promise.all(updates.map((update) => update()));
      });
      currentSettings = getSettings();
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
        (state) => {
          lastSuccessfulLoad = state;
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

    const handleCancelLoad = async (): Promise<void> => {
      const previousLoad =
        lastSuccessfulLoad &&
        currentFileSnapshot &&
        isSameFileSnapshot(lastSuccessfulLoad.snapshot, currentFileSnapshot)
          ? lastSuccessfulLoad
          : undefined;
      abortController?.abort();
      abortController = undefined;
      generation += 1;

      if (previousLoad) {
        currentSettings = previousLoad.settings;
        fullIndex = previousLoad.fullIndex;
        await webviewPanel.webview.postMessage({ type: 'restorePreviousView' });
        await updateSettingsWithoutReload({
          maxRows: previousLoad.settings.maxRows,
          firstRowIsHeader: previousLoad.settings.firstRowIsHeader
        });
        return;
      }

      fullIndex = undefined;
      await updateSettingsWithoutReload({ maxRows: DEFAULT_MAX_ROWS });
      safeLoad();
    };

    disposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === 'ready') {
          webviewReady = true;
          safeLoad();
          return;
        }

        if (message.type === 'cancelLoad') {
          void handleCancelLoad().catch(async (error: unknown) => {
            await webviewPanel.webview.postMessage({
              type: 'settingsError',
              message: formatError(error)
            });
          });
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
          if (suppressSettingsReload) {
            return;
          }

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
      if (clearSuppressSettingsReloadTimer) {
        clearTimeout(clearSuppressSettingsReloadTimer);
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

interface SuccessfulLoadState {
  readonly settings: ViewerSettings;
  readonly snapshot: FileSnapshot;
  readonly fullIndex?: CsvRecordIndex;
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
