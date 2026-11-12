# Quick CSV Viewer

Quick CSV Viewer is a VS Code extension that opens `.csv` files in a readonly,
tabular custom editor designed to stay responsive with large comma-delimited
files.

You can also use it in IDEs that are based on VS Code (such as Cursor).

To install it, simply search its name "Quick CSV Viewer" in the "Extensions"
side panel of VS Code (or Cursor, etc.).

It is hosted both on VS Code marketplace and Open VSX:

- Visual Studio Marketplace:
  <https://marketplace.visualstudio.com/items?itemName=jsh9.quick-csv-viewer>
- Open VSX:
  <https://open-vsx.org/extension/jsh9/quick-csv-viewer>

## 1. Features

- **Very fast file loading**: render the top X rows instead of the whole file.
- **Readonly viewing**: prevent accidental changes to precious data files.
- **Intuitive UI**: toggle cell wrapping, adjust column widths, and inspect CSV
  files in a clean table view.
- **Transposed view**: flip rows and columns to read wide records field by
  field.
- **Copy column names**: copy every column name as a bulleted list in one
  click.

## 2. Screenshots

![](./images/screenshots/quick-view.png)

## 3. Usage

Open any `.csv` file in VS Code and Quick CSV Viewer opens it with the custom
viewer by default.

Git staged and unstaged CSV diffs stay in VS Code's native diff editor.

You can also run `Quick CSV Viewer: Open in Quick CSV Viewer` from the command
palette, the editor title menu, or the Explorer context menu for a `.csv` file.

Use `Ctrl+F` on Windows/Linux or `Cmd+F` on macOS to search text in the rendered
viewer contents. In indexed virtual views, Find searches the rows currently
rendered by the viewport plus the viewer's small overscan buffer; scroll to
search another range.

## 4. Settings

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

## 5. Header Row And Row Index

When `quickCsvViewer.firstRowIsHeader` is enabled, Quick CSV Viewer renders the
first CSV record as the frozen table header and shows it with row index `0`.
Data rows start at row index `1`.

When `quickCsvViewer.firstRowIsHeader` is disabled, Quick CSV Viewer does not
freeze a top header row. The first CSV record is rendered as row index `1`.

The row-index column is always frozen on the left side of the table.

Columns size themselves from the CSV rows already loaded into the viewer. In
indexed mode, that means the visible row range plus the header fields. Drag a
column boundary in the header, or in the generated width-control row when header
mode is off, to resize a column until the viewer is closed or reloaded.

## 6. Indexed Mode

When `quickCsvViewer.maxRows` is `0` or a large positive preview count, Quick CSV
Viewer does not send the whole file to the webview. It builds a byte-offset
record index with progress, then the webview requests only the visible row range
while scrolling. This keeps DOM size bounded for very large files.

## 7. Transposed View

`Transposed view` (next to `Quick view` and `View raw`) flips the table so each
CSV column becomes a row and each CSV row becomes a column. Column names stay
frozen on the left, and row indexes run across the frozen top row. When
`quickCsvViewer.firstRowIsHeader` is enabled, the top-left cell shows `0`, the
index of the header row.

The transposed view shows up to the first 100 rows of the current view. Very
wide files show fewer rows (about 20,000 cells in total) so the viewer stays
responsive. When more rows are available, the info bar says how many the
transposed view shows. Switch back with `Quick view`; each view keeps its
scroll position. The selected view stays active when you change settings or
the file reloads.

## 8. Copy Column Names

`Copy column names` copies all column names to the clipboard as a bulleted
list, one `•` line per column:

```text
• id
• name
• email
```

The list matches the column labels shown in the viewer. When
`quickCsvViewer.firstRowIsHeader` is disabled, that means the generated
`Column 1`, `Column 2`, ... labels. Line breaks inside a column name become
spaces so each column stays on one line. If the clipboard cannot be written,
VS Code shows an error notification.

## 9. Raw Contents

`View raw` opens the file in VS Code's default text editor. The extension's top
info bar is not available there, but you can return to the viewer with
`Open in Quick CSV Viewer` from the editor title, Explorer context menu, or
command palette.

## 10. Notes for Developers

```sh
npm install
npm test
npm run format
```

`npm install` installs Husky hooks automatically. The pre-commit hook runs
`npm test`.
Prettier formats the project with an 80-column print width, and `npm test`
checks formatting before compiling and running the test suite.
`test/webview-runtime.test.ts` runs the generated webview HTML and script in
jsdom with a stubbed VS Code API, so webview behavior is tested by driving it
with host messages.

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
