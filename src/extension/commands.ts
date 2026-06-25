import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SAMPLE_CSV_PATHS, VIEW_TYPE } from './constants';

const DIFF_EDITOR_WARNING =
  'Quick CSV Viewer is not available in diff editors.';

export async function openCsvViewer(resource?: vscode.Uri): Promise<void> {
  if (!resource && isActiveTextDiffEditor()) {
    void vscode.window.showWarningMessage(DIFF_EDITOR_WARNING);
    return;
  }

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

export async function openSampleCsvFiles(
  extensionUri: vscode.Uri
): Promise<void> {
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

  return undefined;
}

function isActiveTextDiffEditor(): boolean {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputTextDiff;
}

function isCsvFile(uri: vscode.Uri): boolean {
  return (
    uri.scheme === 'file' && path.extname(uri.fsPath).toLowerCase() === '.csv'
  );
}
