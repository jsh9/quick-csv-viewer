# Quick CSV Viewer

Quick CSV Viewer opens `.csv` files in a readonly, tabular VS Code custom editor
designed to stay responsive with large comma-delimited files.

## 1. Features

- Open `.csv` files in a readonly custom editor with a fast table view.
- See useful file context, including file size, CSV shape, and last modified
  time.
- Search rendered CSV rows with VS Code's webview Find widget.
- Keep large files responsive with configurable preview limits and indexed
  virtual rendering.
- Toggle wrapped cell contents and header-row mode from the info bar.
- Keep the row-index column frozen while scrolling horizontally.

## 2. Usage

Open any `.csv` file in VS Code and Quick CSV Viewer opens it with the custom
viewer by default.

You can also run `Quick CSV Viewer: Open in Quick CSV Viewer` from the command
palette, the editor title menu, or the Explorer context menu for a `.csv` file.

Use `Ctrl+F` on Windows/Linux or `Cmd+F` on macOS to search text in the rendered
viewer contents. In indexed virtual views, Find searches the rows currently
rendered by the viewport plus the viewer's small overscan buffer; scroll to
search another range.

## 3. Settings

- `quickCsvViewer.maxRows`: number of data rows to show. Default is `20`.
- `quickCsvViewer.maxRows: 0`: index the full file and render visible rows on
  demand.
- The info bar `Show [input] rows` control updates `quickCsvViewer.maxRows`
  globally when you press Enter or leave the field.
- `quickCsvViewer.firstRowIsHeader`: treat the first CSV record as headers.
  Default is `true`.
- The info bar `Header row` control updates
  `quickCsvViewer.firstRowIsHeader` globally.
- `quickCsvViewer.wrapCellContents`: wrap table cell contents. Default is
  `true`.
- The info bar `Wrap cells` control updates
  `quickCsvViewer.wrapCellContents` globally.

## 4. Header Row And Row Index

When `quickCsvViewer.firstRowIsHeader` is enabled, Quick CSV Viewer renders the
first CSV record as the frozen table header and shows it with row index `0`.
Data rows start at row index `1`.

When `quickCsvViewer.firstRowIsHeader` is disabled, Quick CSV Viewer does not
freeze a top header row. The first CSV record is rendered as row index `1`.

The row-index column is always frozen on the left side of the table.

## 5. Indexed Mode

When `quickCsvViewer.maxRows` is `0` or a large positive preview count, Quick CSV
Viewer does not send the whole file to the webview. It builds a byte-offset
record index with progress, then the webview requests only the visible row range
while scrolling. This keeps DOM size bounded for very large files.

## 6. Raw Contents

`View raw` opens the file in VS Code's default text editor. The extension's top
info bar is not available there, but you can return to the viewer with
`Open in Quick CSV Viewer` from the editor title, Explorer context menu, or
command palette.

## 7. Notes for Developers

```sh
npm install
npm test
npm run format
```

`npm install` installs Husky hooks automatically. The pre-commit hook runs
`npm test`.
Prettier formats the project with an 80-column print width, and `npm test`
checks formatting before compiling and running the test suite.

Use VS Code's extension host launch flow to test the viewer manually with the
small and large files in `sample-data/`.

The `Run Extension` launch configuration opens generated files from
`sample-data/` through the internal `quickCsvViewer.openSampleFiles` command.
These `.csv` files are local-only test fixtures and are ignored by Git. Generate
two small fixtures and three 500 MB+ fixtures with:

```sh
python3 sample-data/generate_large_csv.py
```

For a faster smoke test, lower the target size of each large file:

```sh
QUICK_CSV_BIG_SIZE_MB=5 python3 sample-data/generate_large_csv.py
```
