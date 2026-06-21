export function getTableScript(): string {
  return /* js */ `    function createTableShell(payload, columnCount) {
      ensureColumnWidthState(columnCount);

      const scroll = document.createElement('div');
      scroll.className = payload.wrapCellContents ? 'table-scroll wrap-cells' : 'table-scroll';
      applyColumnTemplate(scroll, getColumnWidths(payload, columnCount));

      const table = document.createElement('div');
      table.className = 'csv-table';
      table.setAttribute('role', 'table');

      const body = document.createElement('div');
      body.className = 'table-body';
      body.setAttribute('role', 'rowgroup');

      if (payload.firstRowIsHeader) {
        const header = document.createElement('div');
        header.className = 'table-header';
        header.setAttribute('role', 'row');
        header.append(createIndexCell('0', 'rowheader'));

        for (const [columnIndex, label] of getHeaders(payload, columnCount).entries()) {
          header.append(createHeaderCell(label, columnIndex));
        }

        table.append(header, body);
      } else {
        table.append(createWidthControlRow(columnCount), body);
      }

      scroll.append(table);
      return { scroll, body };
    }

    function renderTableRow(row, columnCount, virtualized, rowIndex) {
      const element = document.createElement('div');
      element.className = 'table-row';
      element.setAttribute('role', 'row');
      element.dataset.rowNumber = String(row.rowNumber);
      if (virtualized) {
        element.dataset.index = String(rowIndex);
      }

      element.append(createIndexCell(String(row.rowNumber), 'rowheader'));
      const cells = normalizeCells(row.cells, columnCount);
      for (const value of cells) {
        const cell = document.createElement('div');
        cell.className = 'table-cell';
        cell.setAttribute('role', 'cell');
        appendCellContent(cell, value);
        cell.title = value;
        element.append(cell);
      }

      return element;
    }

    function createHeaderCell(label, columnIndex) {
      const cell = document.createElement('div');
      cell.className = 'table-cell resizable-cell';
      cell.setAttribute('role', 'columnheader');
      appendCellContent(cell, label);
      cell.title = label;
      cell.append(createColumnResizeHandle(columnIndex));
      return cell;
    }

    function createWidthControlRow(columnCount) {
      const row = document.createElement('div');
      row.className = 'width-control-row';
      row.setAttribute('role', 'row');
      row.append(createIndexCell('', 'presentation'));

      for (const [columnIndex, label] of normalizeHeaders([], columnCount).entries()) {
        row.append(createHeaderCell(label, columnIndex));
      }

      return row;
    }

    function appendCellContent(cell, value) {
      const content = document.createElement('span');
      content.className = 'cell-content';
      content.textContent = value;
      cell.append(content);
    }

    function createIndexCell(value, role) {
      const cell = document.createElement('div');
      cell.className = 'table-cell index-cell';
      cell.setAttribute('role', role);
      cell.textContent = value;
      cell.title = value;
      return cell;
    }

    function getPayloadColumnCount(payload) {
      if (payload.shape && typeof payload.shape.columnCount === 'number') {
        return payload.shape.columnCount;
      }

      if (payload.preview && typeof payload.preview.columnCount === 'number') {
        return payload.preview.columnCount;
      }

      return typeof payload.columnCount === 'number' ? payload.columnCount : 0;
    }

    function getHeaders(payload, columnCount) {
      return normalizeHeaders(payload.headerFields || payload.preview?.headerFields || [], columnCount);
    }

    function normalizeHeaders(headerFields, columnCount) {
      const headers = [];
      for (let index = 0; index < columnCount; index += 1) {
        const value = headerFields[index];
        headers.push(value && value.trim() !== '' ? value : 'Column ' + String(index + 1));
      }
      return headers;
    }

    function normalizeCells(cells, columnCount) {
      const normalized = [];
      for (let index = 0; index < columnCount; index += 1) {
        normalized.push(cells[index] || '');
      }
      return normalized;
    }

    function ensureColumnWidthState(columnCount) {
      if (columnWidthCount === columnCount) {
        return;
      }

      manualColumnWidths = new Map();
      columnWidthCount = columnCount;
      activeColumnResize = null;
      document.body.classList.remove('is-resizing');
    }

    function resetColumnWidths() {
      manualColumnWidths = new Map();
      columnWidthCount = 0;
      activeColumnResize = null;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', handleColumnResize);
      window.removeEventListener('pointerup', stopColumnResize);
      window.removeEventListener('pointercancel', stopColumnResize);
      if (columnResizeFrame) {
        cancelAnimationFrame(columnResizeFrame);
        columnResizeFrame = 0;
      }
    }

    function getColumnWidths(payload, columnCount) {
      const autoWidths = getAutoColumnWidths(payload, columnCount);
      return autoWidths.map((width, index) => manualColumnWidths.get(index) || width);
    }

    function getAutoColumnWidths(payload, columnCount) {
      const widths = new Array(columnCount).fill(MIN_AUTO_COLUMN_WIDTH);
      const includeValue = (columnIndex, value) => {
        if (columnIndex < 0 || columnIndex >= columnCount) {
          return;
        }

        widths[columnIndex] = Math.max(widths[columnIndex], estimateColumnWidth(value));
      };

      if (payload.firstRowIsHeader) {
        for (const [columnIndex, header] of getHeaders(payload, columnCount).entries()) {
          includeValue(columnIndex, header);
        }
      }

      const autosizeRows = payload.preview ? payload.preview.rows : payload.visibleRows || [];
      for (const row of autosizeRows) {
        const cells = normalizeCells(row.cells || [], columnCount);
        for (const [columnIndex, value] of cells.entries()) {
          includeValue(columnIndex, value);
        }
      }

      return widths.map((width) => clampAutoColumnWidth(width || DEFAULT_AUTO_COLUMN_WIDTH));
    }

    function estimateColumnWidth(value) {
      const text = value == null ? '' : String(value);
      const lines = text.split(/\\r\\n|\\r|\\n/);
      let longestLine = 0;
      for (const line of lines) {
        longestLine = Math.max(longestLine, Array.from(line).length);
      }

      return longestLine * COLUMN_WIDTH_CHAR_PX + COLUMN_WIDTH_PADDING_PX;
    }

    function clampAutoColumnWidth(value) {
      return Math.max(MIN_AUTO_COLUMN_WIDTH, Math.min(MAX_AUTO_COLUMN_WIDTH, Math.ceil(value)));
    }

    function clampManualColumnWidth(value) {
      return Math.max(MIN_MANUAL_COLUMN_WIDTH, Math.min(MAX_MANUAL_COLUMN_WIDTH, Math.ceil(value)));
    }

    function applyColumnTemplate(scroll, columnWidths) {
      const roundedWidths = columnWidths.map((width) => Math.max(1, Math.round(width)));
      const template = [INDEX_COLUMN_WIDTH, ...roundedWidths].map((width) => String(width) + 'px').join(' ');
      const totalWidth = roundedWidths.reduce((sum, width) => sum + width, INDEX_COLUMN_WIDTH);
      scroll.style.setProperty('--column-template', template);
      scroll.style.setProperty('--table-min-width', Math.max(INDEX_COLUMN_WIDTH, totalWidth) + 'px');
    }

    function applyCurrentColumnTemplate() {
      const payload = getCurrentTablePayload();
      if (!payload) {
        return;
      }

      const columnCount = getPayloadColumnCount(payload);
      ensureColumnWidthState(columnCount);
      const columnWidths = getColumnWidths(payload, columnCount);
      for (const scroll of document.querySelectorAll('.table-scroll')) {
        applyColumnTemplate(scroll, columnWidths);
      }
    }

    function getCurrentTablePayload() {
      return data || full;
    }

    function createColumnResizeHandle(columnIndex) {
      const handle = document.createElement('span');
      handle.className = 'column-resize-handle';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize column ' + String(columnIndex + 1));
      handle.tabIndex = 0;
      handle.addEventListener('pointerdown', (event) => {
        startColumnResize(event, columnIndex);
      });
      handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetManualColumnWidth(columnIndex);
      });
      handle.addEventListener('keydown', (event) => {
        resizeColumnFromKeyboard(event, columnIndex);
      });
      return handle;
    }

    function startColumnResize(event, columnIndex) {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      const payload = getCurrentTablePayload();
      if (!payload) {
        return;
      }

      const columnCount = getPayloadColumnCount(payload);
      ensureColumnWidthState(columnCount);
      const widths = getColumnWidths(payload, columnCount);
      activeColumnResize = {
        columnIndex,
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: widths[columnIndex] || DEFAULT_AUTO_COLUMN_WIDTH
      };
      document.body.classList.add('is-resizing');
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      window.addEventListener('pointermove', handleColumnResize);
      window.addEventListener('pointerup', stopColumnResize, { once: true });
      window.addEventListener('pointercancel', stopColumnResize, { once: true });
    }

    function handleColumnResize(event) {
      if (!activeColumnResize || event.pointerId !== activeColumnResize.pointerId) {
        return;
      }

      const nextWidth = clampManualColumnWidth(
        activeColumnResize.startWidth + event.clientX - activeColumnResize.startX
      );
      manualColumnWidths.set(activeColumnResize.columnIndex, nextWidth);
      applyCurrentColumnTemplate();
      scheduleRenderedRowMeasurement();
    }

    function stopColumnResize() {
      if (!activeColumnResize) {
        return;
      }

      activeColumnResize = null;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', handleColumnResize);
      window.removeEventListener('pointerup', stopColumnResize);
      window.removeEventListener('pointercancel', stopColumnResize);
      refreshVisibleRowsAfterColumnWidthChange();
    }

    function resetManualColumnWidth(columnIndex) {
      manualColumnWidths.delete(columnIndex);
      applyCurrentColumnTemplate();
      refreshVisibleRowsAfterColumnWidthChange();
    }

    function resizeColumnFromKeyboard(event, columnIndex) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }

      const payload = getCurrentTablePayload();
      if (!payload) {
        return;
      }

      const columnCount = getPayloadColumnCount(payload);
      const widths = getColumnWidths(payload, columnCount);
      const delta = event.key === 'ArrowRight' ? 16 : -16;
      manualColumnWidths.set(
        columnIndex,
        clampManualColumnWidth((widths[columnIndex] || DEFAULT_AUTO_COLUMN_WIDTH) + delta)
      );
      event.preventDefault();
      event.stopPropagation();
      applyCurrentColumnTemplate();
      refreshVisibleRowsAfterColumnWidthChange();
    }

    function scheduleRenderedRowMeasurement() {
      if (columnResizeFrame) {
        cancelAnimationFrame(columnResizeFrame);
      }

      columnResizeFrame = requestAnimationFrame(() => {
        columnResizeFrame = 0;
        measureRenderedRows();
      });
    }

    function refreshVisibleRowsAfterColumnWidthChange() {
      resetVirtualMeasurements();
      if (viewState === 'limitedVirtual') {
        requestLimitedVisibleRows();
        return;
      }

      if (viewState === 'fullReady') {
        requestVisibleRows();
        return;
      }

      measureRenderedRows();
    }`;
}
