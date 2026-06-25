# Changelog

All notable changes to Quick CSV Viewer are documented in this file.

## 0.0.3

- Keep CSV diffs in VS Code's native diff editor while continuing to open CSV
  files in Quick CSV Viewer by default.
- Raise the minimum supported VS Code version to `^1.120.0`.

## 0.0.2

- Refactor CSV parsing, indexing, preview, and formatting logic into focused
  modules.
- Refactor extension activation, command handling, provider loading, settings,
  snapshots, and webview source into smaller files.
- Split CSV and extension test suites into focused files with shared support
  helpers.
- Add clean test builds and enforce 100% runtime coverage for included source
  files.

## 0.0.1

- Initial release of Quick CSV Viewer.
- Add a readonly custom editor for `.csv` files.
- Add configurable preview row limits with full-file indexed rendering support.
- Add file metadata display for size, shape, preview rows, and last modified
  time.
- Add a raw-file handoff button to open CSV files in VS Code's default editor.
- Add table controls for wrapped cells, header-row mode, and a frozen row index
  column.
- Add autosized table columns with drag handles for per-session manual resizing.
- Generate multiple small and large CSV fixtures with quotes, Unicode, ragged
  rows, and multiline edge cases.
- Fix cancelling a large CSV load so the viewer returns to the prior view or a
  top-20-row preview.
