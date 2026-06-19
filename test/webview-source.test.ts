import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

async function readExtensionSource(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), 'src', 'extension.ts'), 'utf8');
}

test('custom editor enables the VS Code find widget for webview search', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /webviewOptions: \{[\s\S]*?enableFindWidget: true,[\s\S]*?retainContextWhenHidden: true/
  );
});

test('custom editor focuses the webview so find shortcuts work after open', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /webviewPanel\.webview\.html = getHtml\(path\.basename\(document\.uri\.fsPath\)\);\s*webviewPanel\.reveal\(webviewPanel\.viewColumn, false\);/
  );
  assert.match(source, /<main id="content" tabindex="-1">/);
  assert.match(source, /content\.focus\(\{ preventScroll: true \}\);/);
});

test('webview top bar labels use CSV shape and Show rows wording', async () => {
  const source = await readExtensionSource();

  assert.match(source, /<strong>Size:<\/strong>/);
  assert.match(source, /<strong>Shape:<\/strong>/);
  assert.match(source, /<strong>Show<\/strong>[\s\S]*<span>rows<\/span>/);
  assert.match(source, /id="wrap-toggle"[\s\S]*<strong>Wrap cells<\/strong>/);
  assert.match(source, /id="header-toggle"[\s\S]*<strong>Header row<\/strong>/);
  assert.match(source, /<strong>Modified:<\/strong>/);
  assert.match(
    source,
    /\.info-item:not\(:first-child\)::before[\s\S]*content: "\|";/
  );
});

test('webview exposes Quick view and View raw controls', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /<button class="mode-button" type="button" id="quick-view" aria-pressed="true">Quick view<\/button>/
  );
  assert.match(
    source,
    /<button class="mode-button raw-action" type="button" id="raw-contents" aria-pressed="false">View raw<\/button>/
  );
  assert.match(source, /vscode\.postMessage\(\{ type: 'rawContents' \}\);/);
  assert.match(source, /'vscode\.openWith',\s*document\.uri,\s*'default'/);
});

test('rows input rejects empty values before posting maxRows updates', async () => {
  const source = await readExtensionSource();

  assert.match(source, /const rawValue = rowsInput\.value\.trim\(\);/);
  assert.match(
    source,
    /if \(rawValue === ''\) \{[\s\S]*?showRowsError\('Rows must be 0 or a positive whole number\.'\);[\s\S]*?return;/
  );
  assert.match(source, /const value = Number\(rawValue\);/);
  assert.match(source, /type: 'updateMaxRows'/);
});

test('rows input hides native number spinner controls', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /\.rows-input \{[\s\S]*?appearance: textfield;[\s\S]*?-moz-appearance: textfield;/
  );
  assert.match(
    source,
    /\.rows-input::-webkit-inner-spin-button,\s*\.rows-input::-webkit-outer-spin-button \{[\s\S]*?-webkit-appearance: none;/
  );
});

test('table header is sticky to freeze the top row', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /\.table-header \{[\s\S]*?position: sticky;[\s\S]*?top: 0;[\s\S]*?z-index: 2;/
  );
  assert.match(
    source,
    /if \(payload\.firstRowIsHeader\) \{[\s\S]*?header\.className = 'table-header';/
  );
  assert.match(source, /cell\.setAttribute\('role', 'columnheader'\);/);
});

test('table keeps a sticky row index column', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /\.index-cell \{[\s\S]*?position: sticky;[\s\S]*?left: 0;[\s\S]*?z-index: 1;/
  );
  assert.match(
    source,
    /header\.append\(createIndexCell\('0', 'rowheader'\)\);/
  );
  assert.match(
    source,
    /element\.append\(createIndexCell\(String\(row\.rowNumber\), 'rowheader'\)\);/
  );
});

test('wrap cells setting is visual-only and persisted without reload', async () => {
  const source = await readExtensionSource();

  assert.match(source, /wrapCellContents/);
  assert.match(source, /type: 'updateWrapCellContents'/);
  assert.match(source, /type: 'wrapCellContents'/);
  assert.match(source, /function applyWrapCellContents\(value\) \{/);
  assert.match(
    source,
    /\.wrap-cells \.table-cell:not\(\.index-cell\) \{[\s\S]*?white-space: pre-wrap;/
  );
  assert.match(
    source,
    /event\.affectsConfiguration\(`\$\{SETTINGS_SECTION\}\.wrapCellContents`\)[\s\S]*?type: 'wrapCellContents'/
  );
});

test('header row toggle updates persisted header setting and reloads', async () => {
  const source = await readExtensionSource();

  assert.match(source, /type: 'updateFirstRowIsHeader'/);
  assert.match(source, /\.update\(\s*'firstRowIsHeader',/);
  assert.match(
    source,
    /event\.affectsConfiguration\(`\$\{SETTINGS_SECTION\}\.firstRowIsHeader`\)[\s\S]*?safeLoad\(\);/
  );
});

test('shape state persists through webview rerenders', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /function withShapeState\(payload\) \{[\s\S]*?shapeState: payload\.shape === null \? 'counting' : 'ready'/
  );
  assert.match(
    source,
    /if \(message\.type === 'shapeError'\) \{[\s\S]*?data\.shapeState = 'unavailable';[\s\S]*?renderLimitedInfo\(\);/
  );
  assert.match(
    source,
    /if \(message\.type === 'shapeError'\) \{[\s\S]*?full\.shapeState = 'unavailable';[\s\S]*?renderFullInfo\(\);/
  );
  assert.match(
    source,
    /function setShapeText\(state, value, progress\) \{[\s\S]*?state === 'unavailable'[\s\S]*?csvShape\.textContent = 'Unavailable';/
  );
});

test('open viewers reload when their file changes', async () => {
  const source = await readExtensionSource();

  assert.match(source, /const FILE_RELOAD_DEBOUNCE_MS = 150;/);
  assert.match(
    source,
    /const scheduleFileReload = \(\): void => \{[\s\S]*?invalidateExactShape\(\);[\s\S]*?fileReloadTimer = setTimeout/
  );
  assert.match(
    source,
    /const scheduleFileReload = \(\): void => \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?safeLoad\(\);[\s\S]*?\}, FILE_RELOAD_DEBOUNCE_MS\);/
  );
  assert.match(
    source,
    /vscode\.workspace\.onDidSaveTextDocument\(\(textDocument\) => \{[\s\S]*?scheduleFileReload\(\);/
  );
  assert.match(
    source,
    /nodeFs\.watch\(\s*path\.dirname\(document\.uri\.fsPath\),\s*\(_eventType,\s*changedFileName\) => \{[\s\S]*?changedName ===\s*path\.basename\(document\.uri\.fsPath\)[\s\S]*?scheduleFileReload\(\);/
  );
});

test('shape progress is posted and rendered', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /onProgress: \(progress\) => \{[\s\S]*?type: 'shapeProgress',[\s\S]*?payload: progress/
  );
  assert.match(
    source,
    /if \(message\.type === 'shapeProgress'\) \{[\s\S]*?data\.shapeState = 'counting';[\s\S]*?data\.shapeProgress = progress;/
  );
  assert.match(
    source,
    /if \(message\.type === 'shapeProgress'\) \{[\s\S]*?full\.shapeState = 'counting';[\s\S]*?full\.shapeProgress = progress;/
  );
  assert.match(source, /function normalizeShapeProgress\(payload\) \{/);
  assert.match(
    source,
    /csvShape\.textContent = progress \? 'Counting ' \+ formatPercent\(progress\.percent\) : 'Counting\.\.\.';/
  );
});

test('shape scans are cached across settings-only reloads', async () => {
  const source = await readExtensionSource();
  const configurationReload =
    /vscode\.workspace\.onDidChangeConfiguration\(\(event\) => \{([\s\S]*?)\n      \}\)\n    \);/.exec(
      source
    )?.[1] ?? '';
  const reloadBranch =
    /if \([\s\S]*?firstRowIsHeader[\s\S]*?\) \{([\s\S]*?)\n        \}/.exec(
      configurationReload
    )?.[1] ?? '';

  assert.match(
    source,
    /interface FileSnapshot \{[\s\S]*?readonly size: number;[\s\S]*?readonly mtimeMs: number;/
  );
  assert.match(source, /let exactShapeCache: ExactShapeCache \| undefined;/);
  assert.match(
    source,
    /let exactShapeRequest: ExactShapeRequest \| undefined;/
  );
  assert.match(reloadBranch, /safeLoad\(\);/);
  assert.doesNotMatch(
    configurationReload,
    /invalidateExactShape|abortExactShape|ensureExactShape/
  );
  assert.match(configurationReload, /wrapCellContents/);
});

test('file snapshot changes invalidate exact shapes', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /function getFileSnapshot\(\s*stats: Pick<nodeFs\.Stats, 'size' \| 'mtimeMs'>\s*\): FileSnapshot/
  );
  assert.match(
    source,
    /function isSameFileSnapshot\(left: FileSnapshot, right: FileSnapshot\): boolean \{[\s\S]*?left\.size === right\.size && left\.mtimeMs === right\.mtimeMs/
  );
  assert.match(
    source,
    /const noteFileSnapshot = \(snapshot: FileSnapshot\): void => \{[\s\S]*?invalidateExactShape\(\);[\s\S]*?currentFileSnapshot = snapshot;/
  );
  assert.match(
    source,
    /const snapshot = getFileSnapshot\(stats\);[\s\S]*?exactShapes\.noteFileSnapshot\(snapshot\);/
  );
});

test('virtual scrolling uses capped physical spacer and logical offsets', async () => {
  const source = await readExtensionSource();

  assert.match(source, /const MAX_VIRTUAL_SCROLL_HEIGHT = 8000000;/);
  assert.match(source, /const MAX_MEASURED_ROW_HEIGHTS = 512;/);
  assert.match(
    source,
    /function getVirtualSpacerHeight\(totalRows\) \{[\s\S]*?Math\.min\(getVirtualTotalHeight\(totalRows\), MAX_VIRTUAL_SCROLL_HEIGHT\)/
  );
  assert.match(
    source,
    /function scrollToLogicalOffset\(scrollOffset, totalRows, viewportHeight\)/
  );
  assert.match(
    source,
    /function getLogicalViewportBottom\(logicalScrollTop, totalRows, viewportHeight\) \{[\s\S]*?Math\.min\(getVirtualTotalHeight\(totalRows\), logicalScrollTop \+ viewportHeight\)/
  );
  assert.match(
    source,
    /function logicalToPhysicalOffset\(logicalOffset, totalRows, viewportHeight\)/
  );
  assert.match(
    source,
    /getIndexAtScrollOffset\(logicalScrollTop, full\.totalRows\)/
  );
  assert.match(source, /function measureRenderedRows\(\) \{/);
  assert.match(source, /function pruneMeasuredRowHeights\(start, count\) \{/);
  assert.match(source, /measuredRowHeights\.set\(index, measuredHeight\);/);
});
