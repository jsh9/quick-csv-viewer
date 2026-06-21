import { INDEXED_PREVIEW_ROW_THRESHOLD } from '../../../csv';
import { getBootstrapScript } from './bootstrap';
import { getControlsScript } from './controls';
import { getRenderingScript } from './rendering';
import { getTableScript } from './table';
import { getVirtualizationScript } from './virtualization';

export function getWebviewScript(): string {
  return [
    getBootstrapScript(INDEXED_PREVIEW_ROW_THRESHOLD),
    getRenderingScript(),
    getTableScript(),
    getVirtualizationScript(),
    getControlsScript(),
    "    vscode.postMessage({ type: 'ready' });"
  ].join('\n\n');
}
