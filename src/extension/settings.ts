import type * as vscode from 'vscode';
import { normalizeViewerSettings } from '../csv';
import type { ViewerSettings } from '../csv';
import { SETTINGS_SECTION } from './constants';

export function getSettings(
  workspace: typeof vscode.workspace
): ViewerSettings {
  const configuration = workspace.getConfiguration(SETTINGS_SECTION);
  return normalizeViewerSettings({
    maxRows: configuration.get('maxRows'),
    firstRowIsHeader: configuration.get('firstRowIsHeader'),
    wrapCellContents: configuration.get('wrapCellContents')
  });
}
