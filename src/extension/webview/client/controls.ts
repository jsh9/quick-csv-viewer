export function getControlsScript(): string {
  return /* js */ `    function setControlsDisabled(disabled) {
      quickViewButton.disabled = disabled;
      transposedViewButton.disabled = disabled;
      rawContentsButton.disabled = disabled;
      copyColumnNamesButton.disabled = disabled || getCurrentColumnNames().length === 0;
      rowsInput.disabled = disabled;
      wrapToggle.disabled = disabled;
      headerToggle.disabled = disabled;
      renderViewModeButtons();
    }

    function renderViewModeButtons() {
      quickViewButton.setAttribute('aria-pressed', String(viewMode === 'table'));
      transposedViewButton.setAttribute('aria-pressed', String(viewMode === 'transposed'));
      rawContentsButton.setAttribute('aria-pressed', 'false');
    }

    function setViewMode(mode) {
      if (viewMode === mode) {
        renderViewModeButtons();
        return;
      }

      saveScrollPosition(viewMode);
      viewMode = mode;
      renderViewModeButtons();
      // Measured row heights stay valid for the same payload, so keeping them
      // lets the restored scroll offset land on the same rows.
      renderReadyView();
      restoreScrollPosition(mode);
    }

    function saveScrollPosition(mode) {
      const scroll = content.querySelector('.table-scroll');
      savedScrollPositions[mode] = scroll
        ? {
            source: getCurrentTablePayload(),
            top: scroll.scrollTop,
            left: scroll.scrollLeft
          }
        : null;
    }

    function restoreScrollPosition(mode) {
      const saved = savedScrollPositions[mode];
      const scroll = content.querySelector('.table-scroll');
      if (!saved || !scroll || saved.source !== getCurrentTablePayload()) {
        return;
      }

      // Virtual views fetch the rows for the restored offset from their scroll handler.
      scroll.scrollTop = saved.top;
      scroll.scrollLeft = saved.left;
    }

    function getCurrentColumnNames() {
      const payload = getCurrentTablePayload();
      if (!payload) {
        return [];
      }

      return getHeaders(payload, getPayloadColumnCount(payload));
    }

    function showCopyColumnNamesFeedback(label, announcement) {
      if (copyFeedbackTimer) {
        clearTimeout(copyFeedbackTimer);
      } else {
        // Keep the toolbar from shifting while the shorter feedback label shows.
        copyColumnNamesButton.style.minWidth =
          String(Math.ceil(copyColumnNamesButton.getBoundingClientRect().width)) + 'px';
      }

      copyColumnNamesButton.textContent = label;
      // Identical live-region text is not announced again, so vary it.
      copyStatus.textContent =
        copyStatus.textContent === announcement ? announcement + '\u00a0' : announcement;
      copyFeedbackTimer = setTimeout(() => {
        copyFeedbackTimer = 0;
        copyColumnNamesButton.textContent = COPY_COLUMN_NAMES_LABEL;
        copyColumnNamesButton.style.minWidth = '';
        copyStatus.textContent = '';
      }, COPY_FEEDBACK_MS);
    }

    function submitMaxRows() {
      if (rowsInput.disabled) {
        return;
      }

      const rawValue = rowsInput.value.trim();
      if (rawValue === '') {
        showRowsError('Rows must be 0 or a positive whole number.');
        return;
      }

      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 0) {
        showRowsError('Rows must be 0 or a positive whole number.');
        return;
      }

      const nextValue = String(value);
      if (nextValue === lastSubmittedMaxRows) {
        return;
      }

      lastSubmittedMaxRows = nextValue;
      clearRowsError();
      vscode.postMessage({
        type: 'updateMaxRows',
        value
      });
    }

    function showRowsError(message) {
      rowsInput.classList.add('invalid');
      rowsError.textContent = message;
    }

    function clearRowsError() {
      rowsInput.classList.remove('invalid');
      rowsError.textContent = '';
    }

    function status(message) {
      const element = document.createElement('p');
      element.className = 'status';
      element.textContent = message;
      return element;
    }

    function textSpan(message) {
      const element = document.createElement('span');
      element.textContent = message;
      return element;
    }

    function formatPercent(value) {
      return Math.max(0, Math.min(100, value)).toFixed(1) + '%';
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) {
        return '0 B';
      }

      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
      }

      return unitIndex === 0 ? String(bytes) + ' B' : value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
    }

    function formatInteger(value) {
      if (!Number.isFinite(value)) {
        return String(value);
      }

      return Math.trunc(value).toLocaleString('en-US');
    }`;
}
