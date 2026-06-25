import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CsvRecordIndex,
  CsvShape,
  DEFAULT_MAX_ROWS,
  ViewerSettings,
  fetchCsvRows,
  getDataRowCount,
  getDisplayRowCount,
  shapeFromRecordScan
} from '../csv';
import { FILE_RELOAD_DEBOUNCE_MS, SETTINGS_SECTION } from './constants';
import { postCsvData, startExactShapeScan } from './loader';
import { getSettings } from './settings';
import { FileSnapshot, isSameFileSnapshot } from './snapshots';
import type {
  ExactShapeCache,
  ExactShapeRequest,
  SuccessfulLoadState,
  WebviewMessage
} from './types';
import { clampMessageInteger, formatError } from './utils';
import { getHtml } from './webview';

class CsvDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {
    // No document-level resources are held.
  }
}

export class CsvViewerProvider implements vscode.CustomReadonlyEditorProvider<CsvDocument> {
  public async openCustomDocument(uri: vscode.Uri): Promise<CsvDocument> {
    return new CsvDocument(uri);
  }

  public async resolveCustomEditor(
    document: CsvDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // VS Code may ask this custom editor to resolve one side of a CSV diff.
    // Hand matching diff tabs back to the native editor so both sides remain.
    const activeTextDiff = getActiveTextDiffForDocument(document.uri);
    if (activeTextDiff) {
      webviewPanel.dispose();
      await vscode.commands.executeCommand(
        'vscode.diff',
        activeTextDiff.original,
        activeTextDiff.modified,
        undefined,
        {
          viewColumn: webviewPanel.viewColumn ?? vscode.ViewColumn.Active
        }
      );
      return;
    }

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

function getActiveTextDiffForDocument(
  uri: vscode.Uri
): vscode.TabInputTextDiff | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputTextDiff)) {
    return undefined;
  }

  if (
    input.original.toString() === uri.toString() ||
    input.modified.toString() === uri.toString()
  ) {
    return input;
  }

  return undefined;
}
