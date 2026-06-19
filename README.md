# Quick CSV Viewer

Quick CSV Viewer opens `.csv` files in a readonly VS Code custom editor designed
to stay responsive with large comma-delimited files.

## 1. Features

- Open `.csv` files in a readonly table view by default.
- Show the first configurable number of data rows quickly. The default is `20`.
- Set the row limit to `0` to index the full file and render visible rows on
  demand.
- See useful file context, including file size, CSV shape, and last modified
  time.
- Keep the header row frozen while scrolling table rows.
- Open the complete CSV in VS Code's default text editor with `View raw`.

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
- `quickCsvViewer.firstRowIsHeader`: treat the first CSV record as headers.
  Default is `true`.
- `quickCsvViewer.wrapCellContents`: wrap table cell contents. Default is
  `true`.
- The info bar `Show [input] rows` control updates
  `quickCsvViewer.maxRows` globally when you press Enter or leave the field.
  The `Wrap cells` and `Header row` controls update their matching settings.

## 4. Notes for Developers

```sh
npm install
npm test
npm run format
```

`npm install` installs Husky hooks automatically. The pre-commit hook runs
`npm test`. Prettier formats the project with an 80-column print width, and
`npm test` checks formatting before compiling and running the test suite.

Use VS Code's extension host launch flow to test the viewer manually with files
in `sample-data/`.

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
