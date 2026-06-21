import * as vscode from 'vscode';
import { ViewerSettings, normalizeViewerSettings } from '../csv';
import { SETTINGS_SECTION } from './constants';

export function getSettings(): ViewerSettings {
  const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return normalizeViewerSettings({
    maxRows: configuration.get('maxRows'),
    firstRowIsHeader: configuration.get('firstRowIsHeader'),
    wrapCellContents: configuration.get('wrapCellContents')
  });
}
