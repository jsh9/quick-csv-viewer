import * as vscode from 'vscode';
import { openCsvViewer, openSampleCsvFiles } from './extension/commands';
import { VIEW_TYPE } from './extension/constants';
import { CsvViewerProvider } from './extension/provider';
import { formatError } from './extension/utils';

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
