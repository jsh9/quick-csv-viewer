export function getTransposedScript(): string {
  return /* js */ `    function renderTransposedLimited() {
      clearVirtualViewport();
      const columnCount = getPayloadColumnCount(data);
      if (columnCount === 0) {
        content.replaceChildren(status('No rows loaded from this CSV file.'));
        return;
      }

      renderTransposedTable(data, data.preview.rows.slice(0, TRANSPOSED_MAX_ROWS), columnCount);
    }

    function renderTransposedFull() {
      clearVirtualViewport();
      const columnCount = getPayloadColumnCount(full);
      if (columnCount === 0) {
        content.replaceChildren(status('No rows loaded from this CSV file.'));
        return;
      }

      if (transposedRows && transposedRowsSource === full) {
        renderTransposedTable(full, transposedRows, columnCount);
        return;
      }

      content.replaceChildren(status('Loading rows for transposed view...'));
      requestTransposedRows();
    }

    function requestTransposedRows() {
      // Indexed views only hold the visible viewport, so fetch the leading
      // rows separately. The latest request wins; older replies are ignored.
      const requestId = 'transposed-' + String(++latestRequestId);
      pendingTransposedRequest = {
        requestId,
        source: full
      };
      vscode.postMessage({
        type: 'fetchRows',
        requestId,
        start: 0,
        count: Math.min(full.totalRows, TRANSPOSED_MAX_ROWS)
      });
    }

    function receiveTransposedRows(rows) {
      const request = pendingTransposedRequest;
      pendingTransposedRequest = null;
      if (request.source !== full) {
        return;
      }

      transposedRows = rows;
      transposedRowsSource = full;
      if (viewMode === 'transposed') {
        renderTransposedFull();
      }
    }

    function clearVirtualViewport() {
      virtualScroll = null;
      virtualSpacer = null;
      virtualRows = null;
    }

    function getTransposableRowCount() {
      if (data) {
        return data.preview.rows.length;
      }

      return full ? full.totalRows : 0;
    }

    function getTransposedStatusSuffix() {
      if (viewMode !== 'transposed' || getTransposableRowCount() <= TRANSPOSED_MAX_ROWS) {
        return '';
      }

      return '; transposed view shows first ' + formatInteger(TRANSPOSED_MAX_ROWS);
    }

    function renderTransposedTable(payload, rows, columnCount) {
      const headers = getHeaders(payload, columnCount);
      const cornerLabel = payload.firstRowIsHeader ? '0' : '';
      const rowCells = rows.map((row) => normalizeCells(row.cells || [], columnCount));

      const scroll = document.createElement('div');
      scroll.className = payload.wrapCellContents
        ? 'table-scroll transposed-scroll wrap-cells'
        : 'table-scroll transposed-scroll';
      applyTransposedTemplate(scroll, getTransposedColumnWidths(cornerLabel, headers, rows, rowCells));

      const table = document.createElement('div');
      table.className = 'csv-table transposed-table';
      table.setAttribute('role', 'table');

      const header = document.createElement('div');
      header.className = 'table-header';
      header.setAttribute('role', 'row');
      header.append(createTransposedRowNumberCell(cornerLabel, true));
      for (const row of rows) {
        header.append(createTransposedRowNumberCell(String(row.rowNumber), false));
      }

      const body = document.createElement('div');
      body.className = 'table-body';
      body.setAttribute('role', 'rowgroup');
      for (const [columnIndex, label] of headers.entries()) {
        const element = document.createElement('div');
        element.className = 'table-row';
        element.setAttribute('role', 'row');
        element.append(createFieldCell(label));
        for (const cells of rowCells) {
          element.append(createDataCell(cells[columnIndex]));
        }
        body.append(element);
      }

      table.append(header, body);
      scroll.append(table);

      if (rows.length === 0) {
        const fragment = document.createDocumentFragment();
        fragment.append(scroll, status('No data rows loaded from this CSV file.'));
        content.replaceChildren(fragment);
        return;
      }

      content.replaceChildren(scroll);
    }

    function createTransposedRowNumberCell(value, isCorner) {
      const cell = document.createElement('div');
      cell.className = isCorner ? 'table-cell field-cell row-number-cell' : 'table-cell row-number-cell';
      cell.setAttribute('role', 'columnheader');
      cell.textContent = value;
      cell.title = value;
      return cell;
    }

    function createFieldCell(label) {
      const cell = document.createElement('div');
      cell.className = 'table-cell field-cell';
      cell.setAttribute('role', 'rowheader');
      appendCellContent(cell, label);
      cell.title = label;
      return cell;
    }

    function getTransposedColumnWidths(cornerLabel, headers, rows, rowCells) {
      let fieldWidth = estimateColumnWidth(cornerLabel);
      for (const header of headers) {
        fieldWidth = Math.max(fieldWidth, estimateColumnWidth(header));
      }

      const widths = [clampAutoColumnWidth(fieldWidth)];
      for (const [rowIndex, cells] of rowCells.entries()) {
        let width = estimateColumnWidth(String(rows[rowIndex].rowNumber));
        for (const value of cells) {
          width = Math.max(width, estimateColumnWidth(value));
        }
        widths.push(clampAutoColumnWidth(width));
      }

      return widths;
    }

    function applyTransposedTemplate(scroll, columnWidths) {
      const roundedWidths = columnWidths.map((width) => Math.max(1, Math.round(width)));
      const template = roundedWidths.map((width) => String(width) + 'px').join(' ');
      const totalWidth = roundedWidths.reduce((sum, width) => sum + width, 0);
      scroll.style.setProperty('--column-template', template);
      scroll.style.setProperty('--table-min-width', String(totalWidth) + 'px');
    }`;
}
