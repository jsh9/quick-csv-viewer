export function getRenderingScript(): string {
  return /* js */ `    function renderLoading() {
      setControlsDisabled(true);
      fileSize.textContent = 'Loading...';
      csvShape.textContent = 'Counting...';
      rowsInput.value = '';
      lastSubmittedMaxRows = '';
      wrapToggle.checked = true;
      headerToggle.checked = true;
      modified.textContent = 'Loading...';
      previewStatus.textContent = '';
      clearRowsError();
      content.replaceChildren(status('Loading CSV preview...'));
    }

    function renderError(message) {
      setControlsDisabled(true);
      fileSize.textContent = 'Unavailable';
      csvShape.textContent = 'Unavailable';
      rowsInput.value = '';
      lastSubmittedMaxRows = '';
      wrapToggle.checked = true;
      headerToggle.checked = true;
      modified.textContent = 'Unavailable';
      previewStatus.textContent = '';
      clearRowsError();
      const panel = document.createElement('div');
      panel.className = 'error-panel';
      panel.textContent = message || 'Unable to load CSV file.';
      content.replaceChildren(panel);
    }

    function renderPreviewLoading() {
      if (!previewLoad || !previewProgress) {
        renderLoading();
        return;
      }

      setControlsDisabled(true);
      fileSize.textContent = previewLoad.fileSize;
      csvShape.textContent = 'Counting...';
      rowsInput.value = String(previewLoad.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(previewLoad);
      modified.textContent = previewLoad.lastModified;
      previewStatus.textContent = cancelLoadRequested
        ? 'Cancelling...'
        : 'Loading preview ' + formatPercent(previewProgress.percent);

      const panel = document.createElement('section');
      panel.className = 'progress-panel';

      const title = document.createElement('p');
      title.className = 'status';
      title.textContent = cancelLoadRequested ? 'Cancelling...' : 'Loading preview...';

      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = Math.max(0, Math.min(100, previewProgress.percent)) + '%';
      track.append(bar);

      const meta = document.createElement('div');
      meta.className = 'progress-meta';
      meta.append(
        textSpan(formatInteger(previewProgress.loadedRowCount) + ' / ' + formatInteger(previewProgress.displayLimit) + ' rows loaded')
      );

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.disabled = cancelLoadRequested;
      cancel.textContent = 'Cancel';
      cancel.addEventListener('pointerdown', requestCancelLoad);
      cancel.addEventListener('click', requestCancelLoad);

      panel.append(title, track, meta, cancel);
      content.replaceChildren(panel);
    }

    function renderLimited() {
      if (!data) {
        renderLoading();
        return;
      }

      setControlsDisabled(false);
      renderLimitedInfo();

      if (data.preview.rows.length >= LIMITED_VIRTUAL_THRESHOLD) {
        renderLimitedVirtualViewer();
        return;
      }

      const columnCount = getPayloadColumnCount(data);
      if (columnCount === 0) {
        content.replaceChildren(status('No rows loaded from this CSV file.'));
        return;
      }

      const shell = createTableShell(data, columnCount);
      for (const row of data.preview.rows) {
        shell.body.append(renderTableRow(row, columnCount, false, 0));
      }

      if (data.preview.rows.length === 0) {
        const fragment = document.createDocumentFragment();
        fragment.append(shell.scroll, status('No data rows loaded from this CSV file.'));
        content.replaceChildren(fragment);
        return;
      }

      content.replaceChildren(shell.scroll);
    }

    function renderLimitedVirtualViewer() {
      if (!data) {
        renderLoading();
        return;
      }

      viewState = 'limitedVirtual';
      const columnCount = getPayloadColumnCount(data);
      const shell = createTableShell(data, columnCount);
      virtualScroll = shell.scroll;
      virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

      virtualSpacer = document.createElement('div');
      virtualSpacer.className = 'virtual-spacer';
      virtualSpacer.style.height = String(getVirtualSpacerHeight(data.preview.rows.length)) + 'px';

      virtualRows = document.createElement('div');
      virtualRows.className = 'virtual-rows';
      virtualSpacer.append(virtualRows);
      shell.body.replaceChildren(virtualSpacer);
      content.replaceChildren(shell.scroll);

      requestLimitedVisibleRows();
    }

    function renderLimitedInfo() {
      fileSize.textContent = data.fileSize;
      setShapeText(data.shapeState, data.shape, data.shapeProgress);
      rowsInput.value = String(data.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(data);
      modified.textContent = data.lastModified;

      const loaded = data.preview.loadedRowCount;
      const limit = data.maxRows;
      if (loaded >= limit) {
        previewStatus.textContent = 'Showing first ' + formatInteger(loaded) + ' rows';
      } else {
        previewStatus.textContent = 'Showing ' + formatInteger(loaded) + ' loaded rows';
      }
    }

    function renderFullIndexing() {
      if (!full || !fullProgress) {
        renderLoading();
        return;
      }

      setControlsDisabled(true);
      fileSize.textContent = full.fileSize;
      csvShape.textContent = 'Indexing...';
      rowsInput.value = String(full.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(full);
      modified.textContent = full.lastModified;
      const indexingLabel = full.maxRows === 0 ? 'Indexing full file' : 'Preparing indexed preview';
      previewStatus.textContent = cancelLoadRequested
        ? 'Cancelling...'
        : indexingLabel + ' ' + formatPercent(fullProgress.percent);

      const panel = document.createElement('section');
      panel.className = 'progress-panel';

      const title = document.createElement('p');
      title.className = 'status';
      title.textContent = cancelLoadRequested ? 'Cancelling...' : indexingLabel + '...';

      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = Math.max(0, Math.min(100, fullProgress.percent)) + '%';
      track.append(bar);

      const meta = document.createElement('div');
      meta.className = 'progress-meta';
      meta.append(
        textSpan(formatPercent(fullProgress.percent)),
        textSpan(formatBytes(fullProgress.bytesRead) + ' / ' + formatBytes(fullProgress.totalBytes)),
        textSpan(formatInteger(fullProgress.indexedRecordCount) + ' records found')
      );

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.disabled = cancelLoadRequested;
      cancel.textContent = 'Cancel';
      cancel.addEventListener('pointerdown', requestCancelLoad);
      cancel.addEventListener('click', requestCancelLoad);

      panel.append(title, track, meta, cancel);
      content.replaceChildren(panel);
    }

    function requestCancelLoad(event) {
      event.preventDefault();
      event.stopPropagation();

      if (cancelLoadRequested) {
        return;
      }

      cancelLoadRequested = true;
      previewStatus.textContent = 'Cancelling...';
      for (const button of content.querySelectorAll('.progress-panel button')) {
        button.disabled = true;
      }
      vscode.postMessage({ type: 'cancelLoad' });
    }

    function restorePreviousView() {
      if (!previousReadyView) {
        renderLoading();
        return;
      }

      cancelLoadRequested = false;
      previewLoad = null;
      previewProgress = null;
      fullProgress = null;
      clearRowsError();
      resetVirtualMeasurements();
      resetColumnWidths();

      if (previousReadyView.type === 'full') {
        viewState = 'fullReady';
        data = null;
        full = previousReadyView.payload;
        renderFullViewer();
        return;
      }

      viewState = 'limited';
      data = previousReadyView.payload;
      full = null;
      renderLimited();
    }

    function renderFullViewer() {
      if (!full) {
        renderLoading();
        return;
      }

      setControlsDisabled(false);
      renderFullInfo();

      const columnCount = getPayloadColumnCount(full);
      if (columnCount === 0) {
        content.replaceChildren(status('No rows loaded from this CSV file.'));
        return;
      }

      const shell = createTableShell(full, columnCount);
      virtualScroll = shell.scroll;
      virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

      virtualSpacer = document.createElement('div');
      virtualSpacer.className = 'virtual-spacer';
      virtualSpacer.style.height = String(getVirtualSpacerHeight(full.totalRows)) + 'px';

      virtualRows = document.createElement('div');
      virtualRows.className = 'virtual-rows';
      virtualSpacer.append(virtualRows);
      shell.body.replaceChildren(virtualSpacer);
      content.replaceChildren(shell.scroll);

      requestVisibleRows();
    }

    function renderFullInfo() {
      if (!full) {
        return;
      }

      fileSize.textContent = full.fileSize;
      setShapeText(full.shapeState, full.shape, full.shapeProgress);
      rowsInput.value = String(full.maxRows);
      lastSubmittedMaxRows = rowsInput.value;
      renderSettingsControls(full);
      modified.textContent = full.lastModified;

      if (full.maxRows === 0) {
        previewStatus.textContent = 'Virtual full-file view';
        return;
      }

      if (!full.shape) {
        previewStatus.textContent = 'Showing first ' + formatInteger(full.totalRows) + ' rows';
        return;
      }

      if (full.totalRows >= full.shape.rowCount) {
        previewStatus.textContent = 'Showing all ' + formatInteger(full.shape.rowCount) + ' rows';
        return;
      }

      previewStatus.textContent =
        'Showing first ' + formatInteger(full.totalRows) + ' of ' + formatInteger(full.shape.rowCount) + ' rows';
    }

    function withShapeState(payload) {
      return {
        ...payload,
        shapeState: payload.shape === null ? 'counting' : 'ready',
        shapeProgress: null
      };
    }

    function setShapeText(state, value, progress) {
      if (state === 'unavailable') {
        csvShape.textContent = 'Unavailable';
        return;
      }

      if (state === 'ready' && value) {
        csvShape.textContent =
          formatInteger(value.rowCount) + ' rows x ' + formatInteger(value.columnCount) + ' columns';
        return;
      }

      csvShape.textContent = progress ? 'Counting ' + formatPercent(progress.percent) : 'Counting...';
    }

    function normalizeShapeProgress(payload) {
      if (!payload || typeof payload.percent !== 'number' || !Number.isFinite(payload.percent)) {
        return null;
      }

      return {
        percent: payload.percent,
        rowCount: typeof payload.rowCount === 'number' ? payload.rowCount : null,
        columnCount: typeof payload.columnCount === 'number' ? payload.columnCount : null
      };
    }

    function renderCurrentSettings() {
      const payload = data || full || previewLoad;
      if (payload) {
        renderSettingsControls(payload);
      }
    }

    function renderSettingsControls(payload) {
      wrapToggle.checked = Boolean(payload.wrapCellContents);
      headerToggle.checked = Boolean(payload.firstRowIsHeader);
    }

    function applyWrapCellContents(value) {
      if (data) {
        data.wrapCellContents = value;
      }

      if (full) {
        full.wrapCellContents = value;
      }

      if (previewLoad) {
        previewLoad.wrapCellContents = value;
      }

      wrapToggle.checked = value;
      resetVirtualMeasurements();

      if (viewState === 'limited' || viewState === 'limitedVirtual') {
        renderLimited();
        return;
      }

      if (viewState === 'fullReady') {
        renderFullViewer();
      }
    }`;
}
