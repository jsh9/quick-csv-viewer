import { getWebviewScript } from './webview/client/script';
import { escapeHtml, getNonce } from './webview/security';
import { getWebviewStyles } from './webview/styles';

export function getHtml(fileName: string): string {
  const nonce = getNonce();
  const escapedTitle = escapeHtml(fileName);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style nonce="${nonce}">
${getWebviewStyles()}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="info" aria-live="polite">
      <span class="info-item"><strong>Size:</strong> <span id="file-size">Loading...</span></span>
      <span class="info-item"><strong>Shape:</strong> <span id="csv-shape">Counting...</span></span>
      <label class="rows-control info-item"><strong>Show</strong> <input id="rows-input" class="rows-input" type="number" min="0" step="1" inputmode="numeric" aria-describedby="rows-error"> <span>rows</span></label>
      <label class="toggle-control info-item"><input id="wrap-toggle" type="checkbox" checked> <strong>Wrap cells</strong></label>
      <label class="toggle-control info-item"><input id="header-toggle" type="checkbox" checked> <strong>Header row</strong></label>
      <span id="rows-error" class="rows-error" role="status"></span>
      <span class="info-item"><strong>Modified:</strong> <span id="modified">Loading...</span></span>
      <span id="preview-status"></span>
    </div>
    <div class="actions">
      <div class="mode-tabs" role="toolbar" aria-label="CSV view mode">
        <button class="mode-button" type="button" id="quick-view" aria-pressed="true">Quick view</button>
        <button class="mode-button raw-action" type="button" id="raw-contents" aria-pressed="false">View raw</button>
      </div>
    </div>
  </header>
  <main id="content" tabindex="-1">
    <p class="status">Loading CSV preview...</p>
  </main>
  <script nonce="${nonce}">
${getWebviewScript()}
  </script>
</body>
</html>`;
}
