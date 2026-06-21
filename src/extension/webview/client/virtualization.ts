export function getVirtualizationScript(): string {
  return /* js */ `    function scheduleVisibleRowsRequest() {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        if (viewState === 'limitedVirtual') {
          requestLimitedVisibleRows();
          return;
        }

        requestVisibleRows();
      });
    }

    function requestVisibleRows() {
      if (!full || !virtualScroll) {
        return;
      }

      const viewport = getBodyViewport();
      const logicalScrollTop = scrollToLogicalOffset(
        viewport.scrollTop,
        full.totalRows,
        viewport.height
      );
      const logicalScrollBottom = getLogicalViewportBottom(
        logicalScrollTop,
        full.totalRows,
        viewport.height
      );
      const start = Math.max(0, getIndexAtScrollOffset(logicalScrollTop, full.totalRows) - OVERSCAN);
      const end = Math.min(
        full.totalRows,
        getIndexAtScrollOffset(logicalScrollBottom, full.totalRows) + OVERSCAN + 1
      );
      const count = Math.max(0, end - start);
      const requestId = 'rows-' + String(++latestRequestId);
      pendingRequestId = requestId;

      vscode.postMessage({
        type: 'fetchRows',
        requestId,
        start,
        count
      });
    }

    function requestLimitedVisibleRows() {
      if (!data || !virtualScroll) {
        return;
      }

      const totalRows = data.preview.rows.length;
      const viewport = getBodyViewport();
      const logicalScrollTop = scrollToLogicalOffset(
        viewport.scrollTop,
        totalRows,
        viewport.height
      );
      const logicalScrollBottom = getLogicalViewportBottom(
        logicalScrollTop,
        totalRows,
        viewport.height
      );
      const start = Math.max(0, getIndexAtScrollOffset(logicalScrollTop, totalRows) - OVERSCAN);
      const end = Math.min(
        totalRows,
        getIndexAtScrollOffset(logicalScrollBottom, totalRows) + OVERSCAN + 1
      );
      const count = Math.max(0, end - start);
      renderLimitedVirtualRows(start, count);
    }

    function renderLimitedVirtualRows(start, count) {
      if (!virtualRows || !virtualSpacer || !data) {
        return;
      }

      const totalRows = data.preview.rows.length;
      const columnCount = getPayloadColumnCount(data);
      const viewport = getBodyViewport();
      currentVirtualStart = start;
      currentVirtualTotalRows = totalRows;
      pruneMeasuredRowHeights(start, count);
      virtualSpacer.style.height = String(getVirtualSpacerHeight(totalRows)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(logicalToPhysicalOffset(getVirtualOffset(start), totalRows, viewport.height)) +
        'px)';

      const fragment = document.createDocumentFragment();
      for (let index = start; index < start + count; index += 1) {
        const row = data.preview.rows[index];
        if (row) {
          fragment.append(renderTableRow(row, columnCount, true, index));
        }
      }
      virtualRows.replaceChildren(fragment);
      measureRenderedRows();
    }

    function renderVirtualRows(start, rows, totalRows) {
      if (!virtualRows || !virtualSpacer || !full) {
        return;
      }

      full.totalRows = totalRows;
      full.visibleRows = rows;
      const columnCount = getPayloadColumnCount(full);
      applyCurrentColumnTemplate();
      const viewport = getBodyViewport();
      currentVirtualStart = start;
      currentVirtualTotalRows = totalRows;
      pruneMeasuredRowHeights(start, rows.length);
      virtualSpacer.style.height = String(getVirtualSpacerHeight(totalRows)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(logicalToPhysicalOffset(getVirtualOffset(start), totalRows, viewport.height)) +
        'px)';

      const fragment = document.createDocumentFragment();
      for (let index = 0; index < rows.length; index += 1) {
        fragment.append(renderTableRow(rows[index], columnCount, true, start + index));
      }
      virtualRows.replaceChildren(fragment);
      measureRenderedRows();
    }

    function getBodyViewport() {
      const header = virtualScroll ? virtualScroll.querySelector('.table-header, .width-control-row') : null;
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      return {
        scrollTop: Math.max(0, virtualScroll.scrollTop - headerHeight),
        height: Math.max(1, virtualScroll.clientHeight - headerHeight)
      };
    }

    function getEstimatedRowHeight() {
      return ROW_HEIGHT;
    }

    function getVirtualTotalHeight(totalRows) {
      const estimatedRowHeight = getEstimatedRowHeight();
      let total = totalRows * estimatedRowHeight;
      for (const [index, height] of measuredRowHeights) {
        if (index >= 0 && index < totalRows) {
          total += height - estimatedRowHeight;
        }
      }

      return Math.max(0, total);
    }

    function getVirtualSpacerHeight(totalRows) {
      return Math.min(getVirtualTotalHeight(totalRows), MAX_VIRTUAL_SCROLL_HEIGHT);
    }

    function scrollToLogicalOffset(scrollOffset, totalRows, viewportHeight) {
      const logicalHeight = getVirtualTotalHeight(totalRows);
      const physicalHeight = getVirtualSpacerHeight(totalRows);
      const logicalMax = Math.max(0, logicalHeight - viewportHeight);
      const physicalMax = Math.max(0, physicalHeight - viewportHeight);

      if (logicalMax === 0 || physicalMax === 0) {
        return Math.max(0, Math.min(logicalHeight, scrollOffset));
      }

      return Math.max(0, Math.min(logicalMax, (scrollOffset / physicalMax) * logicalMax));
    }

    function getLogicalViewportBottom(logicalScrollTop, totalRows, viewportHeight) {
      return Math.max(
        0,
        Math.min(getVirtualTotalHeight(totalRows), logicalScrollTop + viewportHeight)
      );
    }

    function logicalToPhysicalOffset(logicalOffset, totalRows, viewportHeight) {
      const logicalHeight = getVirtualTotalHeight(totalRows);
      const physicalHeight = getVirtualSpacerHeight(totalRows);
      const logicalMax = Math.max(0, logicalHeight - viewportHeight);
      const physicalMax = Math.max(0, physicalHeight - viewportHeight);

      if (logicalMax === 0 || physicalMax === 0 || physicalHeight === logicalHeight) {
        return logicalOffset;
      }

      return Math.max(0, Math.min(physicalMax, (logicalOffset / logicalMax) * physicalMax));
    }

    function getVirtualOffset(index) {
      const estimatedRowHeight = getEstimatedRowHeight();
      let offset = index * estimatedRowHeight;
      for (const [measuredIndex, height] of measuredRowHeights) {
        if (measuredIndex >= 0 && measuredIndex < index) {
          offset += height - estimatedRowHeight;
        }
      }

      return Math.max(0, offset);
    }

    function getIndexAtScrollOffset(scrollOffset, totalRows) {
      if (totalRows <= 0) {
        return 0;
      }

      let low = 0;
      let high = totalRows - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const nextOffset = getVirtualOffset(middle + 1);
        if (nextOffset <= scrollOffset) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      return low;
    }

    function measureRenderedRows() {
      if (!virtualRows || !virtualSpacer || !virtualScroll) {
        return;
      }

      let changed = false;
      for (const row of virtualRows.children) {
        const index = Number(row.dataset.index);
        if (!Number.isInteger(index)) {
          continue;
        }

        const measuredHeight = row.getBoundingClientRect().height;
        const previousHeight = measuredRowHeights.get(index);
        if (!previousHeight || Math.abs(previousHeight - measuredHeight) > 1) {
          measuredRowHeights.set(index, measuredHeight);
          changed = true;
        }
      }

      pruneMeasuredRowHeights(currentVirtualStart, virtualRows.children.length);

      if (!changed) {
        return;
      }

      const viewport = getBodyViewport();
      virtualSpacer.style.height = String(getVirtualSpacerHeight(currentVirtualTotalRows)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(
          logicalToPhysicalOffset(
            getVirtualOffset(currentVirtualStart),
            currentVirtualTotalRows,
            viewport.height
          )
        ) +
        'px)';
    }

    function resetVirtualMeasurements() {
      measuredRowHeights = new Map();
      currentVirtualStart = 0;
      currentVirtualTotalRows = 0;
    }

    function pruneMeasuredRowHeights(start, count) {
      if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
        return;
      }

      const windowStart = Math.max(0, start - OVERSCAN * 4);
      const windowEnd = start + count + OVERSCAN * 4;
      for (const index of measuredRowHeights.keys()) {
        if (index < windowStart || index > windowEnd) {
          measuredRowHeights.delete(index);
        }
      }

      if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
        return;
      }

      for (const index of measuredRowHeights.keys()) {
        if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
          return;
        }

        measuredRowHeights.delete(index);
      }
    }`;
}
