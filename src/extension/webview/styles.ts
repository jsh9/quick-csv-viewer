export function getWebviewStyles(): string {
  return /* css */ `    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
    }

    .info-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .info-item:not(:first-child)::before {
      content: "|";
      color: var(--vscode-descriptionForeground);
      margin-right: 4px;
      user-select: none;
    }

    .info strong {
      color: var(--vscode-editor-foreground);
      font-weight: 600;
    }

    .rows-control,
    .toggle-control {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .toggle-control input {
      margin: 0;
    }

    .rows-input {
      appearance: textfield;
      -moz-appearance: textfield;
      width: 72px;
      min-width: 0;
      border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
      border-radius: 3px;
      padding: 2px 6px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }

    .rows-input::-webkit-inner-spin-button,
    .rows-input::-webkit-outer-spin-button {
      margin: 0;
      -webkit-appearance: none;
    }

    .rows-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .rows-input.invalid {
      border-color: var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-input-background));
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-input-foreground));
    }

    .rows-input:disabled {
      opacity: 0.55;
    }

    .rows-error {
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      flex-wrap: wrap;
    }

    button {
      min-width: 86px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 4px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .mode-tabs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .mode-button {
      min-width: auto;
      border: 0;
      padding: 4px 9px;
      color: var(--vscode-foreground);
      background: transparent;
    }

    .mode-button:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground));
    }

    .mode-button[aria-pressed="true"] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .mode-button.raw-action {
      border-left: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 0 2px 2px 0;
    }

    main {
      padding: 12px;
    }

    .status,
    .error-panel {
      margin: 0 0 12px;
      color: var(--vscode-descriptionForeground);
    }

    .error-panel {
      padding: 10px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }

    .progress-panel {
      display: grid;
      gap: 10px;
      max-width: 720px;
      padding: 12px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .progress-track {
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--vscode-progressBar-background, var(--vscode-editorWidget-border));
    }

    .progress-bar {
      width: 0%;
      height: 100%;
      background: var(--vscode-button-background);
      transition: width 120ms linear;
    }

    .progress-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      color: var(--vscode-descriptionForeground);
    }

    .table-scroll {
      height: calc(100vh - 78px);
      min-height: 240px;
      overflow: auto;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
      --column-template: 58px;
    }

    .csv-table {
      min-width: var(--table-min-width, 100%);
    }

    .table-header,
    .width-control-row,
    .table-row {
      display: grid;
      grid-template-columns: var(--column-template);
    }

    .table-header,
    .width-control-row {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      box-shadow: 0 1px 0 var(--vscode-editorWidget-border, var(--vscode-panel-border));
    }

    .table-body {
      position: relative;
    }

    .table-cell {
      min-height: 30px;
      min-width: 0;
      padding: 6px 8px;
      border-right: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.35;
    }

    .cell-content {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: inherit;
    }

    .wrap-cells .table-cell:not(.index-cell) {
      overflow-wrap: anywhere;
      text-overflow: clip;
      white-space: pre-wrap;
    }

    .wrap-cells .cell-content {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .index-cell {
      position: sticky;
      left: 0;
      z-index: 1;
      color: var(--vscode-editorLineNumber-foreground);
      background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
      text-align: right;
      user-select: none;
      white-space: nowrap;
    }

    .table-header .table-cell,
    .width-control-row .table-cell {
      color: var(--vscode-editor-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      font-family: var(--vscode-font-family);
      font-weight: 600;
    }

    .width-control-row .table-cell {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .table-header .index-cell,
    .width-control-row .index-cell {
      z-index: 3;
    }

    .resizable-cell {
      position: relative;
      padding-right: 16px;
    }

    .column-resize-handle {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 8px;
      cursor: col-resize;
      touch-action: none;
    }

    .column-resize-handle::after {
      position: absolute;
      top: 6px;
      right: 3px;
      bottom: 6px;
      width: 1px;
      background: var(--vscode-editorWidget-border, var(--vscode-panel-border));
      content: "";
    }

    .column-resize-handle:hover::after,
    .column-resize-handle:focus::after {
      width: 2px;
      background: var(--vscode-focusBorder);
    }

    body.is-resizing,
    body.is-resizing * {
      cursor: col-resize !important;
      user-select: none !important;
    }

    .table-row:nth-child(even) .table-cell {
      background: var(--vscode-list-hoverBackground, transparent);
    }

    .table-row:nth-child(even) .index-cell {
      background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
    }

    .virtual-spacer {
      position: relative;
      min-height: 100%;
    }

    .virtual-rows {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      will-change: transform;
    }

    @media (max-width: 640px) {
      .topbar {
        align-items: stretch;
        flex-direction: column;
      }

      .actions,
      .mode-tabs {
        width: 100%;
      }

      .mode-button {
        flex: 1 1 auto;
      }
    }`;
}
