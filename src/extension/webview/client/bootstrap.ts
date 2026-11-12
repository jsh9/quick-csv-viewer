export function getBootstrapScript(indexedPreviewRowThreshold: number): string {
  return /* js */ `    const vscode = acquireVsCodeApi();
    const content = document.getElementById('content');
    const quickViewButton = document.getElementById('quick-view');
    const transposedViewButton = document.getElementById('transposed-view');
    const rawContentsButton = document.getElementById('raw-contents');
    const copyColumnNamesButton = document.getElementById('copy-column-names');
    const copyStatus = document.getElementById('copy-status');
    const fileSize = document.getElementById('file-size');
    const csvShape = document.getElementById('csv-shape');
    const rowsInput = document.getElementById('rows-input');
    const wrapToggle = document.getElementById('wrap-toggle');
    const headerToggle = document.getElementById('header-toggle');
    const rowsError = document.getElementById('rows-error');
    const modified = document.getElementById('modified');
    const previewStatus = document.getElementById('preview-status');

    const OVERSCAN = 10;
    const ROW_HEIGHT = 31;
    const LIMITED_VIRTUAL_THRESHOLD = ${indexedPreviewRowThreshold};
    const MAX_VIRTUAL_SCROLL_HEIGHT = 8000000;
    const MAX_MEASURED_ROW_HEIGHTS = 512;
    const INDEX_COLUMN_WIDTH = 58;
    const MIN_AUTO_COLUMN_WIDTH = 80;
    const DEFAULT_AUTO_COLUMN_WIDTH = 140;
    const MAX_AUTO_COLUMN_WIDTH = 280;
    const COLUMN_WIDTH_CHAR_PX = 8;
    const COLUMN_WIDTH_PADDING_PX = 24;
    const MIN_MANUAL_COLUMN_WIDTH = 48;
    const MAX_MANUAL_COLUMN_WIDTH = 900;
    const TRANSPOSED_MAX_ROWS = 100;
    const TRANSPOSED_MAX_CELLS = 20000;
    const COPY_COLUMN_NAMES_LABEL = 'Copy column names';
    const COPY_FEEDBACK_MS = 1500;

    let viewState = 'loading';
    let data = null;
    let full = null;
    let previousReadyView = null;
    let fullProgress = null;
    let previewLoad = null;
    let previewProgress = null;
    let virtualScroll = null;
    let virtualSpacer = null;
    let virtualRows = null;
    let latestRequestId = 0;
    let pendingRequestId = '';
    let cancelLoadRequested = false;
    let animationFrame = 0;
    let columnResizeFrame = 0;
    let lastSubmittedMaxRows = '';
    let measuredRowHeights = new Map();
    let currentVirtualStart = 0;
    let currentVirtualTotalRows = 0;
    let manualColumnWidths = new Map();
    let columnWidthCount = 0;
    let activeColumnResize = null;
    let viewMode = 'table';
    let transposedCache = null;
    let pendingTransposedRequest = null;
    let savedScrollPositions = { table: null, transposed: null };
    let renderedView = null;
    let copyFeedbackTimer = 0;

    content.focus({ preventScroll: true });

    quickViewButton.addEventListener('click', () => {
      setViewMode('table');
    });

    transposedViewButton.addEventListener('click', () => {
      setViewMode('transposed');
    });

    copyColumnNamesButton.addEventListener('click', () => {
      const columnNames = getCurrentColumnNames();
      if (columnNames.length === 0) {
        return;
      }

      vscode.postMessage({
        type: 'copyColumnNames',
        value: columnNames
      });
    });

    rawContentsButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'rawContents' });
    });

    rowsInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitMaxRows();
      }
    });

    rowsInput.addEventListener('blur', () => {
      submitMaxRows();
    });

    rowsInput.addEventListener('input', () => {
      clearRowsError();
    });

    wrapToggle.addEventListener('change', () => {
      const value = wrapToggle.checked;
      applyWrapCellContents(value);
      vscode.postMessage({
        type: 'updateWrapCellContents',
        value
      });
    });

    headerToggle.addEventListener('change', () => {
      vscode.postMessage({
        type: 'updateFirstRowIsHeader',
        value: headerToggle.checked
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.type === 'loading') {
        viewState = 'loading';
        cancelLoadRequested = false;
        pendingTransposedRequest = null;
        data = null;
        full = null;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        renderLoading();
        return;
      }

      if (message.type === 'data') {
        viewState = 'limited';
        cancelLoadRequested = false;
        data = withShapeState(message.payload);
        full = null;
        previousReadyView = {
          type: 'limited',
          payload: data
        };
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        renderLimited();
        return;
      }

      if (message.type === 'shape') {
        if (data) {
          data.shape = message.shape;
          data.shapeState = 'ready';
          data.shapeProgress = null;
          renderLimited();
          return;
        }

        if (full) {
          full.shape = message.shape;
          full.shapeState = 'ready';
          full.shapeProgress = null;
          // A shape scan from an earlier load can finish while the index is
          // still building. Keep the progress panel; fullIndexReady picks the
          // shape up from here if its own payload has none.
          if (viewState === 'fullReady') {
            renderFullViewer();
          }
          return;
        }

        if (viewState !== 'previewLoading') {
          setShapeText('ready', message.shape, null);
        }
        return;
      }

      if (message.type === 'shapeProgress') {
        const progress = normalizeShapeProgress(message.payload);
        if (data) {
          data.shapeState = 'counting';
          data.shapeProgress = progress;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.shapeState = 'counting';
          full.shapeProgress = progress;
          if (viewState === 'fullReady') {
            renderFullInfo();
          }
          return;
        }

        if (viewState !== 'previewLoading') {
          setShapeText('counting', null, progress);
        }
        return;
      }

      if (message.type === 'shapeError') {
        if (data) {
          data.shapeState = 'unavailable';
          data.shapeProgress = null;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.shapeState = 'unavailable';
          full.shapeProgress = null;
          if (viewState === 'fullReady') {
            renderFullInfo();
          }
          return;
        }

        if (viewState !== 'previewLoading') {
          setShapeText('unavailable', null, null);
        }
        return;
      }

      if (message.type === 'maxRowsError') {
        showRowsError(message.message || 'Rows must be 0 or a positive whole number.');
        return;
      }

      if (message.type === 'settingsError') {
        previewStatus.textContent = message.message || 'Unable to update settings.';
        renderCurrentSettings();
        return;
      }

      if (message.type === 'wrapCellContents') {
        applyWrapCellContents(Boolean(message.value));
        return;
      }

      if (message.type === 'previewLoadStart') {
        viewState = 'previewLoading';
        cancelLoadRequested = false;
        pendingTransposedRequest = null;
        data = null;
        full = null;
        previewLoad = message.payload;
        previewProgress = {
          loadedRowCount: 0,
          displayLimit: message.payload.displayLimit,
          percent: 0
        };
        resetColumnWidths();
        renderPreviewLoading();
        return;
      }

      if (message.type === 'previewLoadProgress') {
        previewProgress = message.payload;
        if (viewState === 'previewLoading') {
          renderPreviewLoading();
        }
        return;
      }

      if (message.type === 'fullIndexStart') {
        viewState = 'fullIndexing';
        cancelLoadRequested = false;
        pendingTransposedRequest = null;
        data = null;
        full = message.payload;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        fullProgress = {
          bytesRead: 0,
          totalBytes: message.payload.totalBytes,
          percent: 0,
          indexedRecordCount: 0,
          columnCount: 0
        };
        renderFullIndexing();
        return;
      }

      if (message.type === 'fullIndexProgress') {
        fullProgress = message.payload;
        if (viewState === 'fullIndexing') {
          renderFullIndexing();
        }
        return;
      }

      if (message.type === 'fullIndexReady') {
        // Shape messages received while this load was indexing can be newer
        // than payload.shape, so keep their state when the payload has none.
        const indexingFull = viewState === 'fullIndexing' ? full : null;
        viewState = 'fullReady';
        cancelLoadRequested = false;
        full = withShapeState(message.payload);
        if (full.shape === null && indexingFull) {
          if (indexingFull.shapeState === 'ready') {
            full.shape = indexingFull.shape;
            full.shapeState = 'ready';
          } else if (indexingFull.shapeState === 'counting') {
            full.shapeProgress = indexingFull.shapeProgress;
          }
        }
        previousReadyView = {
          type: 'full',
          payload: full
        };
        fullProgress = null;
        resetVirtualMeasurements();
        resetColumnWidths();
        renderFullViewer();
        return;
      }

      if (message.type === 'restorePreviousView') {
        restorePreviousView();
        return;
      }

      if (message.type === 'rows') {
        if (viewState !== 'fullReady') {
          return;
        }

        if (pendingTransposedRequest && message.requestId === pendingTransposedRequest.requestId) {
          receiveTransposedRows(message.payload.rows);
          return;
        }

        if (message.requestId !== pendingRequestId) {
          return;
        }

        renderVirtualRows(message.payload.start, message.payload.rows, message.payload.totalRows);
        return;
      }

      if (message.type === 'columnNamesCopied') {
        const count = typeof message.count === 'number' ? message.count : 0;
        showCopyColumnNamesFeedback(
          'Copied!',
          'Copied ' + formatInteger(count) + (count === 1 ? ' column name' : ' column names') + ' to the clipboard.'
        );
        return;
      }

      if (message.type === 'copyColumnNamesError') {
        showCopyColumnNamesFeedback('Copy failed', message.message || 'Unable to copy column names.');
        return;
      }

      if (message.type === 'error') {
        cancelLoadRequested = false;
        data = null;
        full = null;
        viewState = 'error';
        renderError(message.message);
      }
    });`;
}
