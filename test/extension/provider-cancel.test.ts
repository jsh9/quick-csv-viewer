import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  fetchCsvRows as realFetchCsvRows,
  indexCsvFile as realIndexCsvFile
} from '../../src/csv';
import {
  createFakeWebviewPanel,
  FakeUri,
  getRegisteredProvider,
  hasMessageType,
  isMessage,
  makeAbortError,
  sleep,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

test('custom editor provider cancels first loads back to a default limited preview', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      vscode.__state.configuration.maxRows = 0;
      const csvPath = path.join(tempDir, 'cancel-first.csv');
      await fs.writeFile(
        csvPath,
        [
          'a,b',
          ...Array.from({ length: 5_000 }, (_, index) => `${index},v${index}`)
        ].join('\n'),
        'utf8'
      );
      extension.activate({
        extensionUri: new FakeUri('/tmp/extension'),
        subscriptions: []
      });
      const provider = getRegisteredProvider(vscode).provider;
      const uri = new FakeUri(csvPath);
      const document = await provider.openCustomDocument(uri);
      const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

      await provider.resolveCustomEditor(document, panel, {});
      panel.webview.receive({ type: 'ready' });
      panel.webview.receive({ type: 'cancelLoad' });

      await waitFor(() => vscode.__state.configuration.maxRows === 20);
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.maxRows === 20 &&
            message.payload.preview?.loadedRowCount === 20
        )
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('custom editor provider restores the previous successful view when cancelling a later load', async () => {
  const pendingSignals: AbortSignal[] = [];

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 1;
        vscode.__state.configuration.firstRowIsHeader = true;
        const csvPath = path.join(tempDir, 'cancel-restore.csv');
        await fs.writeFile(csvPath, 'a,b\n1,2\n3,4\n5,6', 'utf8');
        extension.activate({
          extensionUri: new FakeUri('/tmp/extension'),
          subscriptions: []
        });
        const provider = getRegisteredProvider(vscode).provider;
        const uri = new FakeUri(csvPath);
        const document = await provider.openCustomDocument(uri);
        const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

        await provider.resolveCustomEditor(document, panel, {});
        panel.webview.receive({ type: 'ready' });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'data' &&
              message.payload?.maxRows === 1
          )
        );

        panel.webview.receive({ type: 'updateMaxRows', value: 0 });
        await waitFor(() => pendingSignals.length === 1);
        panel.webview.receive({
          type: 'updateFirstRowIsHeader',
          value: false
        });
        await waitFor(() => pendingSignals.length === 2);
        assert.equal(pendingSignals[0]?.aborted, true);

        panel.webview.receive({ type: 'cancelLoad' });
        await waitFor(
          () =>
            vscode.__state.configuration.maxRows === 1 &&
            vscode.__state.configuration.firstRowIsHeader === true
        );
        assert.equal(pendingSignals[1]?.aborted, true);
        assert.ok(
          hasMessageType(panel.webview.messages, 'restorePreviousView')
        );

        vscode.__state.configuration.maxRows = 0;
        vscode.__state.configuration.firstRowIsHeader = false;
        panel.webview.receive({ type: 'cancelLoad' });
        await waitFor(
          () =>
            panel.webview.messages.filter(
              (message) =>
                isMessage(message) && message.type === 'restorePreviousView'
            ).length >= 2 &&
            vscode.__state.configuration.maxRows === 1 &&
            vscode.__state.configuration.firstRowIsHeader === true
        );

        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        indexCsvFile: (
          filePath: string,
          options: {
            readonly recordLimit?: number;
            readonly signal?: AbortSignal;
          }
        ) => {
          if (options.recordLimit === undefined) {
            pendingSignals.push(options.signal as AbortSignal);
            return new Promise((_resolve, reject) => {
              options.signal?.addEventListener(
                'abort',
                () => reject(makeAbortError()),
                { once: true }
              );
            });
          }

          return realIndexCsvFile(filePath, options);
        }
      }
    }
  );
});

test('custom editor provider restores indexed views and drops stale row responses after cancellation', async () => {
  let resolveHeldRows:
    | ((rows: Awaited<ReturnType<typeof realFetchCsvRows>>) => void)
    | undefined;
  let holdNextRows = true;

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 0;
        const csvPath = path.join(tempDir, 'stale-rows.csv');
        await fs.writeFile(csvPath, 'a,b\n1,2\n3,4\n5,6', 'utf8');
        extension.activate({
          extensionUri: new FakeUri('/tmp/extension'),
          subscriptions: []
        });
        const provider = getRegisteredProvider(vscode).provider;
        const uri = new FakeUri(csvPath);
        const document = await provider.openCustomDocument(uri);
        const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

        await provider.resolveCustomEditor(document, panel, {});
        panel.webview.receive({ type: 'ready' });
        await waitFor(() =>
          hasMessageType(panel.webview.messages, 'fullIndexReady')
        );

        panel.webview.receive({
          type: 'fetchRows',
          requestId: 'stale',
          start: 0,
          count: 1
        });
        await waitFor(() => Boolean(resolveHeldRows));
        panel.webview.receive({ type: 'cancelLoad' });
        await waitFor(() =>
          hasMessageType(panel.webview.messages, 'restorePreviousView')
        );

        resolveHeldRows?.({
          start: 0,
          rows: [{ rowNumber: 1, cells: ['stale', 'row'] }],
          indexedDataRowCount: 3
        });
        await sleep(20);
        assert.equal(
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'rows' &&
              message.requestId === 'stale'
          ),
          false
        );

        panel.webview.receive({
          type: 'fetchRows',
          requestId: 'after-restore',
          start: 1,
          count: 1
        });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'rows' &&
              message.requestId === 'after-restore'
          )
        );

        const restoredRows = panel.webview.messages.find(
          (message) =>
            isMessage(message) &&
            message.type === 'rows' &&
            message.requestId === 'after-restore'
        );
        assert.ok(isMessage(restoredRows));
        assert.deepEqual(restoredRows.payload?.rows, [
          { rowNumber: 2, cells: ['3', '4'] }
        ]);

        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        fetchCsvRows: (
          filePath: string,
          index: Parameters<typeof realFetchCsvRows>[1],
          options: Parameters<typeof realFetchCsvRows>[2]
        ) => {
          if (holdNextRows) {
            holdNextRows = false;
            return new Promise((resolve) => {
              resolveHeldRows = resolve;
            });
          }

          return realFetchCsvRows(filePath, index, options);
        }
      }
    }
  );
});
