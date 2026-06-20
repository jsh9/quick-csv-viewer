import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { SAMPLE_CSV_PATHS, VIEW_TYPE } from './constants';

type VscodeApi = typeof vscode;

export async function openCsvViewer(
  vscodeApi: VscodeApi,
  resource?: vscode.Uri
): Promise<void> {
  const uri = resource ?? getActiveEditorUri(vscodeApi);

  if (!uri) {
    void vscodeApi.window.showWarningMessage(
      'Open a CSV file before running Quick CSV Viewer.'
    );
    return;
  }

  if (!isCsvFile(uri)) {
    void vscodeApi.window.showWarningMessage(
      'Quick CSV Viewer can only open .csv files.'
    );
    return;
  }

  await vscodeApi.commands.executeCommand(
    'vscode.openWith',
    uri,
    VIEW_TYPE,
    vscodeApi.ViewColumn.Active
  );
}

export async function openSampleCsvFiles(
  vscodeApi: VscodeApi,
  extensionUri: vscode.Uri
): Promise<void> {
  let openedCount = 0;

  for (const relativePath of SAMPLE_CSV_PATHS) {
    const uri = vscodeApi.Uri.joinPath(
      extensionUri,
      ...relativePath.split('/')
    );
    try {
      await fs.access(uri.fsPath);
    } catch {
      continue;
    }

    const column =
      openedCount === 0
        ? vscodeApi.ViewColumn.One
        : vscodeApi.ViewColumn.Beside;
    await vscodeApi.commands.executeCommand(
      'vscode.openWith',
      uri,
      VIEW_TYPE,
      column
    );
    openedCount += 1;
  }

  if (openedCount === 0) {
    void vscodeApi.window.showWarningMessage(
      'No sample CSV files found. Run python3 sample-data/generate_large_csv.py first.'
    );
  }
}

function getActiveEditorUri(vscodeApi: VscodeApi): vscode.Uri | undefined {
  const activeTextEditorUri = vscodeApi.window.activeTextEditor?.document.uri;

  if (activeTextEditorUri) {
    return activeTextEditorUri;
  }

  const input = vscodeApi.window.tabGroups.activeTabGroup.activeTab?.input;

  if (
    input instanceof vscodeApi.TabInputText ||
    input instanceof vscodeApi.TabInputCustom
  ) {
    return input.uri;
  }

  if (input instanceof vscodeApi.TabInputTextDiff) {
    return input.modified;
  }

  return undefined;
}

function isCsvFile(uri: vscode.Uri): boolean {
  return (
    uri.scheme === 'file' && path.extname(uri.fsPath).toLowerCase() === '.csv'
  );
}
