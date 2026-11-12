import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

async function readExtensionSource(): Promise<string> {
  const sourcePaths = [
    ['src', 'extension.ts'],
    ['src', 'extension', 'commands.ts'],
    ['src', 'extension', 'constants.ts'],
    ['src', 'extension', 'loader.ts'],
    ['src', 'extension', 'provider.ts'],
    ['src', 'extension', 'settings.ts'],
    ['src', 'extension', 'snapshots.ts'],
    ['src', 'extension', 'types.ts'],
    ['src', 'extension', 'utils.ts'],
    ['src', 'extension', 'webview.ts'],
    ['src', 'extension', 'webview', 'styles.ts'],
    ['src', 'extension', 'webview', 'security.ts'],
    ['src', 'extension', 'webview', 'client', 'bootstrap.ts'],
    ['src', 'extension', 'webview', 'client', 'rendering.ts'],
    ['src', 'extension', 'webview', 'client', 'table.ts'],
    ['src', 'extension', 'webview', 'client', 'transposed.ts'],
    ['src', 'extension', 'webview', 'client', 'virtualization.ts'],
    ['src', 'extension', 'webview', 'client', 'controls.ts'],
    ['src', 'extension', 'webview', 'client', 'script.ts']
  ];
  const sources = await Promise.all(
    sourcePaths.map((segments) =>
      fs.readFile(path.join(process.cwd(), ...segments), 'utf8')
    )
  );
  return sources.join('\n');
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

test('webview places Transposed view between Quick view and View raw', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /id="quick-view"[^\n]*\n\s*<button class="mode-button" type="button" id="transposed-view" aria-pressed="false" disabled>Transposed view<\/button>\n\s*<button[^\n]*id="raw-contents"/
  );
  assert.match(
    source,
    /transposedViewButton\.addEventListener\('click', \(\) => \{\s*setViewMode\('transposed'\);/
  );
  assert.match(
    source,
    /quickViewButton\.addEventListener\('click', \(\) => \{\s*setViewMode\('table'\);/
  );
  assert.match(
    source,
    /function renderViewModeButtons\(\) \{[\s\S]*?quickViewButton\.setAttribute\('aria-pressed', String\(viewMode === 'table'\)\);[\s\S]*?transposedViewButton\.setAttribute\('aria-pressed', String\(viewMode === 'transposed'\)\);/
  );
  assert.match(
    source,
    /function setControlsDisabled\(disabled\) \{[\s\S]*?transposedViewButton\.disabled = disabled;[\s\S]*?renderViewModeButtons\(\);/
  );
});

test('view mode survives reloads and restores each view scroll position', async () => {
  const source = await readExtensionSource();

  assert.match(source, /let viewMode = 'table';/);
  assert.match(
    source,
    /function setViewMode\(mode\) \{[\s\S]*?saveScrollPosition\(viewMode\);\s*viewMode = mode;\s*renderViewModeButtons\(\);[\s\S]*?renderReadyView\(\);\s*restoreScrollPosition\(mode\);\s*\}/
  );
  assert.match(
    source,
    /function renderReadyView\(\) \{\s*if \(viewState === 'limited' \|\| viewState === 'limitedVirtual'\) \{\s*renderLimited\(\);\s*return;\s*\}\s*if \(viewState === 'fullReady'\) \{\s*renderFullViewer\(\);/
  );
  assert.match(
    source,
    /function applyWrapCellContents\(value\) \{[\s\S]*?resetVirtualMeasurements\(\);\s*renderReadyView\(\);/
  );
  assert.match(
    source,
    /function restoreScrollPosition\(mode\) \{[\s\S]*?saved\.source !== getCurrentTablePayload\(\)[\s\S]*?scroll\.scrollTop = saved\.top;\s*scroll\.scrollLeft = saved\.left;/
  );
  assert.match(
    source,
    /renderLimitedInfo\(\);\s*if \(viewMode === 'transposed'\) \{\s*renderTransposedLimited\(\);\s*return;\s*\}\s*if \(data\.preview\.rows\.length >= LIMITED_VIRTUAL_THRESHOLD\)/
  );
  assert.match(
    source,
    /renderFullInfo\(\);\s*if \(viewMode === 'transposed'\) \{\s*renderTransposedFull\(\);\s*return;\s*\}/
  );
});

test('transposed view renders CSV columns as rows with a frozen field column', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /renderTransposedTable\(data, data\.preview\.rows\.slice\(0, getTransposedRowLimit\(columnCount\)\), columnCount\);/
  );
  assert.match(
    source,
    /const cornerLabel = payload\.firstRowIsHeader \? '0' : '';/
  );
  assert.match(
    source,
    /header\.append\(createTransposedRowNumberCell\(String\(row\.rowNumber\), false\)\);/
  );
  assert.match(
    source,
    /for \(const \[columnIndex, label\] of headers\.entries\(\)\) \{[\s\S]*?element\.append\(createFieldCell\(label\)\);[\s\S]*?element\.append\(createDataCell\(cells\[columnIndex\]\)\);/
  );
  assert.match(
    source,
    /applyGridTemplate\(scroll, getTransposedColumnWidths\(cornerLabel, headers, rows, rowCells\)\);/
  );
  assert.match(
    source,
    /\.field-cell \{[\s\S]*?position: sticky;[\s\S]*?left: 0;[\s\S]*?z-index: 1;/
  );
  assert.match(source, /\.table-header \.field-cell \{[\s\S]*?z-index: 3;/);
  assert.match(
    source,
    /querySelectorAll\('\.table-scroll:not\(\.transposed-scroll\)'\)/
  );
});

test('transposed view caps rendered cells so wide files stay responsive', async () => {
  const source = await readExtensionSource();

  assert.match(source, /const TRANSPOSED_MAX_ROWS = 100;/);
  assert.match(source, /const TRANSPOSED_MAX_CELLS = 20000;/);
  assert.match(
    source,
    /function getTransposedRowLimit\(columnCount\) \{[\s\S]*?const budgetRows = Math\.floor\(TRANSPOSED_MAX_CELLS \/ Math\.max\(1, columnCount\)\);\s*return Math\.max\(1, Math\.min\(TRANSPOSED_MAX_ROWS, budgetRows\)\);/
  );
  assert.match(
    source,
    /function getTransposedStatusSuffix\(\) \{[\s\S]*?const limit = getTransposedRowLimit\(getPayloadColumnCount\(payload\)\);[\s\S]*?'; transposed view shows first ' \+ formatInteger\(limit\)/
  );
  assert.match(
    source,
    /function setPreviewStatus\(message\) \{\s*previewStatus\.textContent = message \+ getTransposedStatusSuffix\(\);/
  );
});

test('indexed transposed view fetches leading rows once per loaded payload', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /function requestTransposedRows\(count\) \{[\s\S]*?const requestId = 'transposed-' \+ String\(\+\+latestRequestId\);[\s\S]*?pendingTransposedRequest = \{[\s\S]*?source: full,\s*count[\s\S]*?type: 'fetchRows',[\s\S]*?start: 0,\s*count/
  );
  assert.match(
    source,
    /const count = Math\.min\(full\.totalRows, getTransposedRowLimit\(columnCount\)\);\s*if \(transposedCache && transposedCache\.source === full && transposedCache\.count === count\) \{\s*renderTransposedTable\(full, transposedCache\.rows, columnCount\);/
  );
  assert.match(
    source,
    /pendingTransposedRequest\.source === full &&\s*pendingTransposedRequest\.count === count\s*\) \{\s*return;\s*\}\s*requestTransposedRows\(count\);/
  );
  assert.match(
    source,
    /if \(pendingTransposedRequest && message\.requestId === pendingTransposedRequest\.requestId\) \{\s*receiveTransposedRows\(message\.payload\.rows\);/
  );
  assert.match(
    source,
    /function receiveTransposedRows\(rows\) \{[\s\S]*?if \(request\.source !== full\) \{[\s\S]*?transposedCache = \{\s*source: full,\s*count: request\.count,\s*rows\s*\};/
  );
  for (const type of ['loading', 'previewLoadStart', 'fullIndexStart']) {
    assert.match(
      source,
      new RegExp(
        `if \\(message\\.type === '${type}'\\) \\{[^}]*?pendingTransposedRequest = null;`
      )
    );
  }
  assert.match(
    source,
    /function renderTransposedFull\(\) \{\s*clearVirtualViewport\(\);/
  );
});

test('copy column names button posts the displayed column labels', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /<button class="secondary-button" type="button" id="copy-column-names" title="Copy all column names as a bulleted list" disabled>Copy column names<\/button>\s*<span id="copy-status" class="visually-hidden" role="status"><\/span>\s*<div class="mode-tabs"/
  );
  assert.match(
    source,
    /copyColumnNamesButton\.addEventListener\('click', \(\) => \{[\s\S]*?const columnNames = getCurrentColumnNames\(\);[\s\S]*?type: 'copyColumnNames',\s*value: columnNames/
  );
  assert.match(
    source,
    /function getCurrentColumnNames\(\) \{[\s\S]*?return getHeaders\(payload, getPayloadColumnCount\(payload\)\);/
  );
  assert.match(
    source,
    /copyColumnNamesButton\.disabled = disabled \|\| getCurrentColumnNames\(\)\.length === 0;/
  );
  assert.match(
    source,
    /await vscode\.env\.clipboard\.writeText\(formatBulletedList\(message\.value\)\);/
  );
});

test('copy column names announces results in a live region that renders do not overwrite', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /if \(message\.type === 'columnNamesCopied'\) \{[\s\S]*?showCopyColumnNamesFeedback\(\s*'Copied!',\s*'Copied ' \+ formatInteger\(count\)/
  );
  assert.match(
    source,
    /if \(message\.type === 'copyColumnNamesError'\) \{\s*showCopyColumnNamesFeedback\('Copy failed', message\.message \|\| 'Unable to copy column names\.'\);\s*return;/
  );
  assert.match(
    source,
    /function showCopyColumnNamesFeedback\(label, announcement\) \{[\s\S]*?copyStatus\.textContent = announcement;[\s\S]*?copyStatus\.textContent = '';/
  );
  assert.match(
    source,
    /\.visually-hidden \{[\s\S]*?position: absolute;[\s\S]*?clip: rect\(0 0 0 0\);/
  );
  assert.match(
    source,
    /void vscode\.window\.showErrorMessage\(\s*`Unable to copy column names: \$\{reason\}`\s*\);/
  );
});

test('table fills the space under the wrapping topbar instead of a fixed offset', async () => {
  const source = await readExtensionSource();

  assert.doesNotMatch(source, /calc\(100vh - 78px\)/);
  assert.match(
    source,
    /body \{\s*display: flex;\s*flex-direction: column;\s*height: 100vh;/
  );
  assert.match(
    source,
    /main \{\s*display: flex;\s*flex: 1 1 auto;\s*flex-direction: column;\s*min-height: 0;/
  );
  assert.match(
    source,
    /\.table-scroll \{\s*flex: 1 1 auto;\s*min-height: 240px;/
  );
  assert.match(source, /\.topbar \{[\s\S]*?flex-wrap: wrap;/);
  assert.match(
    source,
    /@media \(max-width: 640px\) \{[\s\S]*?\.info \{\s*flex: 0 0 auto;/
  );
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
    /\.table-header,\s*\.width-control-row \{[\s\S]*?position: sticky;[\s\S]*?top: 0;[\s\S]*?z-index: 2;/
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

test('webview autosizes data columns from loaded rows', async () => {
  const source = await readExtensionSource();

  assert.doesNotMatch(
    source,
    /repeat\(var\(--column-count\), minmax\(140px, 1fr\)\)/
  );
  assert.match(source, /const MAX_AUTO_COLUMN_WIDTH = 280;/);
  assert.match(
    source,
    /function getAutoColumnWidths\(payload, columnCount\) \{[\s\S]*?const autosizeRows = payload\.preview \? payload\.preview\.rows : payload\.visibleRows \|\| \[\];/
  );
  assert.match(source, /text\.split\(\/\\\\r\\\\n\|\\\\r\|\\\\n\/\);/);
  assert.match(
    source,
    /function applyColumnTemplate\(scroll, columnWidths\) \{[\s\S]*?--column-template/
  );
  assert.match(
    source,
    /applyGridTemplate\(scroll, \[INDEX_COLUMN_WIDTH, \.\.\.columnWidths\]\);/
  );
});

test('webview keeps manual column widths per session and resets on reload or column-count change', async () => {
  const source = await readExtensionSource();

  assert.match(source, /let manualColumnWidths = new Map\(\);/);
  assert.match(
    source,
    /function ensureColumnWidthState\(columnCount\) \{[\s\S]*?manualColumnWidths = new Map\(\);[\s\S]*?columnWidthCount = columnCount;/
  );
  assert.match(
    source,
    /function resetColumnWidths\(\) \{[\s\S]*?manualColumnWidths = new Map\(\);[\s\S]*?columnWidthCount = 0;/
  );
  assert.match(source, /resetColumnWidths\(\);[\s\S]*?renderLimited\(\);/);
  assert.match(source, /resetColumnWidths\(\);[\s\S]*?renderFullViewer\(\);/);
});

test('webview renders drag handles and double-click reset for column resizing', async () => {
  const source = await readExtensionSource();

  assert.match(source, /handle\.className = 'column-resize-handle';/);
  assert.match(source, /handle\.addEventListener\('pointerdown'/);
  assert.match(source, /function handleColumnResize\(event\) \{/);
  assert.match(
    source,
    /manualColumnWidths\.set\(activeColumnResize\.columnIndex, nextWidth\);/
  );
  assert.match(
    source,
    /handle\.addEventListener\('dblclick'[\s\S]*?resetManualColumnWidth\(columnIndex\);/
  );
});

test('header-off mode renders a generated width-control row instead of a CSV header row', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /table\.append\(createWidthControlRow\(columnCount\), body\);/
  );
  assert.match(source, /row\.className = 'width-control-row';/);
  assert.match(
    source,
    /for \(const \[columnIndex, label\] of normalizeHeaders\(\[\], columnCount\)\.entries\(\)\)/
  );
  assert.match(source, /row\.append\(createIndexCell\('', 'presentation'\)\);/);
});

test('virtual views refresh autosizing from visible rows while preserving measured heights', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /full\.visibleRows = rows;[\s\S]*?applyCurrentColumnTemplate\(\);/
  );
  assert.match(
    source,
    /function refreshVisibleRowsAfterColumnWidthChange\(\) \{[\s\S]*?resetVirtualMeasurements\(\);[\s\S]*?requestLimitedVisibleRows\(\);[\s\S]*?requestVisibleRows\(\);/
  );
  assert.match(source, /scheduleRenderedRowMeasurement\(\);/);
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

test('load cancellation restores previous provider state or falls back to 20 rows', async () => {
  const source = await readExtensionSource();

  assert.match(source, /DEFAULT_MAX_ROWS/);
  assert.match(
    source,
    /let lastSuccessfulLoad: SuccessfulLoadState \| undefined;/
  );
  assert.match(source, /let suppressSettingsReload = false;/);
  assert.match(source, /const runWithoutSettingsReload = async/);
  assert.match(
    source,
    /const handleCancelLoad = async \(\): Promise<void> => \{[\s\S]*isSameFileSnapshot\(lastSuccessfulLoad\.snapshot, currentFileSnapshot\)[\s\S]*abortController\?\.abort\(\);[\s\S]*generation \+= 1;/
  );
  assert.match(
    source,
    /fullIndex = previousLoad\.fullIndex;[\s\S]*type: 'restorePreviousView'/
  );
  assert.match(
    source,
    /updateSettingsWithoutReload\(\{[\s\S]*maxRows: previousLoad\.settings\.maxRows,[\s\S]*firstRowIsHeader: previousLoad\.settings\.firstRowIsHeader/
  );
  assert.match(
    source,
    /updateSettingsWithoutReload\(\{ maxRows: DEFAULT_MAX_ROWS \}\);[\s\S]*safeLoad\(\);/
  );
  assert.match(
    source,
    /if \(message\.type === 'cancelLoad'\) \{[\s\S]*handleCancelLoad\(\)/
  );
  assert.match(
    source,
    /if \(suppressSettingsReload\) \{[\s\S]*return;[\s\S]*\}[\s\S]*safeLoad\(\);/
  );
  assert.match(
    source,
    /noteSuccessfulLoad\(\{[\s\S]*settings: \{ \.\.\.settings \},[\s\S]*snapshot,[\s\S]*fullIndex: index/
  );
  assert.doesNotMatch(
    source,
    /fullIndexCancelled|renderCancelled|Loading was cancelled/
  );
});

test('webview cancel buttons request load cancellation and restore cached ready views', async () => {
  const source = await readExtensionSource();
  const cancelPosts =
    source.match(/vscode\.postMessage\(\{ type: 'cancelLoad' \}\);/g) ?? [];

  assert.equal(cancelPosts.length, 1);
  assert.match(source, /let cancelLoadRequested = false;/);
  assert.match(
    source,
    /cancel\.addEventListener\('pointerdown', requestCancelLoad\);[\s\S]*cancel\.addEventListener\('click', requestCancelLoad\);/
  );
  assert.match(
    source,
    /function requestCancelLoad\(event\) \{[\s\S]*event\.preventDefault\(\);[\s\S]*if \(cancelLoadRequested\) \{[\s\S]*return;[\s\S]*cancelLoadRequested = true;[\s\S]*previewStatus\.textContent = 'Cancelling\.\.\.';[\s\S]*vscode\.postMessage\(\{ type: 'cancelLoad' \}\);/
  );
  assert.match(
    source,
    /previewStatus\.textContent = cancelLoadRequested[\s\S]*\? 'Cancelling\.\.\.'[\s\S]*: 'Loading preview '/
  );
  assert.match(
    source,
    /previewStatus\.textContent = cancelLoadRequested[\s\S]*\? 'Cancelling\.\.\.'[\s\S]*: indexingLabel \+ ' '/
  );
  assert.match(source, /let previousReadyView = null;/);
  assert.match(
    source,
    /if \(message\.type === 'data'\) \{[\s\S]*previousReadyView = \{[\s\S]*type: 'limited',[\s\S]*payload: data/
  );
  assert.match(
    source,
    /if \(message\.type === 'fullIndexReady'\) \{[\s\S]*previousReadyView = \{[\s\S]*type: 'full',[\s\S]*payload: full/
  );
  assert.match(
    source,
    /if \(message\.type === 'restorePreviousView'\) \{[\s\S]*restorePreviousView\(\);/
  );
  assert.match(
    source,
    /function restorePreviousView\(\) \{[\s\S]*previousReadyView\.type === 'full'[\s\S]*renderFullViewer\(\);[\s\S]*viewState = 'limited';[\s\S]*renderLimited\(\);/
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
    /function isSameFileSnapshot\([\s\S]*?left: FileSnapshot,[\s\S]*?right: FileSnapshot[\s\S]*?\): boolean \{[\s\S]*?left\.size === right\.size && left\.mtimeMs === right\.mtimeMs/
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
