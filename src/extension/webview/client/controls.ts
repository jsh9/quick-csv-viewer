export function getControlsScript(): string {
  return /* js */ `    function setControlsDisabled(disabled) {
      quickViewButton.disabled = disabled;
      rawContentsButton.disabled = disabled;
      rowsInput.disabled = disabled;
      wrapToggle.disabled = disabled;
      headerToggle.disabled = disabled;
      quickViewButton.setAttribute('aria-pressed', 'true');
      rawContentsButton.setAttribute('aria-pressed', 'false');
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
