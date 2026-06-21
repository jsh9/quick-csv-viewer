import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { readCsvPreview as realReadCsvPreview } from '../../src/csv';
import {
  countMessages,
  createFakeWebviewPanel,
  FakeUri,
  getRegisteredProvider,
  hasMessageType,
  isMessage,
  sleep,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

test('custom editor provider loads limited previews and handles validation messages', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      const csvPath = path.join(tempDir, 'preview.csv');
      await fs.writeFile(csvPath, 'a,b\n1,2\n3,4', 'utf8');
      extension.activate({
        extensionUri: new FakeUri('/tmp/extension'),
        subscriptions: []
      });
      const provider = getRegisteredProvider(vscode).provider;
      const uri = new FakeUri(csvPath);
      const document = await provider.openCustomDocument(uri);
      const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

      await provider.resolveCustomEditor(document, panel, {});
      assert.equal(panel.webview.options.enableScripts, true);
      assert.match(panel.webview.html, /id="content"/);
      assert.deepEqual(panel.reveals, [
        { column: vscode.ViewColumn.Active, preserveFocus: false }
      ]);

      panel.webview.receive({ type: 'ready' });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.preview?.loadedRowCount === 2
        )
      );

      assert.ok(hasMessageType(panel.webview.messages, 'loading'));
      assert.ok(hasMessageType(panel.webview.messages, 'previewLoadStart'));
      panel.webview.receive({ type: 'updateMaxRows', value: -1 });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) => isMessage(message) && message.type === 'maxRowsError'
        )
      );
      panel.webview.receive({ type: 'updateMaxRows', value: '10' });
      await waitFor(
        () => countMessages(panel.webview.messages, 'maxRowsError') >= 2
      );

      panel.webview.receive({
        type: 'updateFirstRowIsHeader',
        value: 'yes'
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) => isMessage(message) && message.type === 'settingsError'
        )
      );

      panel.webview.receive({
        type: 'updateWrapCellContents',
        value: 'no'
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'settingsError' &&
            message.message === 'Wrap cells must be on or off.'
        )
      );

      panel.webview.receive({
        type: 'updateWrapCellContents',
        value: false
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'wrapCellContents' &&
            message.value === false
        )
      );

      panel.webview.receive({ type: 'updateMaxRows', value: 1 });
      await waitFor(() => vscode.__state.configuration.maxRows === 1);

      panel.webview.receive({
        type: 'updateFirstRowIsHeader',
        value: false
      });
      await waitFor(
        () => vscode.__state.configuration.firstRowIsHeader === false
      );

      panel.webview.receive({
        type: 'fetchRows',
        requestId: 'missing-index',
        start: 0,
        count: 1
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'error' &&
            message.message === 'The CSV row index is not ready yet.'
        )
      );

      panel.webview.receive({ type: 'rawContents' });
      assert.deepEqual(vscode.__state.executedCommands.at(-1), [
        'vscode.openWith',
        uri,
        'default',
        vscode.ViewColumn.Active
      ]);

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('custom editor provider ignores stale preview progress and completion', async () => {
  let firstPreviewOptions: Parameters<typeof realReadCsvPreview>[2] | undefined;
  let resolveFirstPreview:
    | ((preview: Awaited<ReturnType<typeof realReadCsvPreview>>) => void)
    | undefined;
  let previewCallCount = 0;

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 2;
        const csvPath = path.join(tempDir, 'stale-preview.csv');
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
        await waitFor(() => Boolean(resolveFirstPreview));

        panel.webview.receive({ type: 'updateMaxRows', value: 1 });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'data' &&
              message.payload?.maxRows === 1
          )
        );

        const progressCount = countMessages(
          panel.webview.messages,
          'previewLoadProgress'
        );
        const dataCount = countMessages(panel.webview.messages, 'data');
        firstPreviewOptions?.onProgress?.({
          loadedRowCount: 99,
          displayLimit: 99,
          percent: 99
        });
        resolveFirstPreview?.({
          headers: ['stale'],
          headerFields: ['stale'],
          rows: [{ rowNumber: 1, cells: ['stale'] }],
          loadedRowCount: 1,
          displayLimit: 2,
          columnCount: 1,
          indexedRecordCount: 2,
          isComplete: true
        });
        await sleep(20);

        assert.equal(
          countMessages(panel.webview.messages, 'previewLoadProgress'),
          progressCount
        );
        assert.equal(countMessages(panel.webview.messages, 'data'), dataCount);

        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        readCsvPreview: (
          filePath: string,
          settings: Parameters<typeof realReadCsvPreview>[1],
          options: Parameters<typeof realReadCsvPreview>[2]
        ) => {
          previewCallCount += 1;
          if (previewCallCount === 1) {
            firstPreviewOptions = options;
            return new Promise((resolve) => {
              resolveFirstPreview = resolve;
            });
          }

          return realReadCsvPreview(filePath, settings, options);
        }
      }
    }
  );
});

test('custom editor provider rejects unsupported URI schemes', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    extension.activate({
      extensionUri: new FakeUri('/tmp/extension'),
      subscriptions: []
    });
    const provider = getRegisteredProvider(vscode).provider;
    const uri = new FakeUri('/tmp/preview.csv', 'untitled');
    const document = await provider.openCustomDocument(uri);
    assert.equal(typeof document.dispose, 'function');
    document.dispose();
    const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitFor(() =>
      panel.webview.messages.some(
        (message) =>
          isMessage(message) &&
          message.type === 'error' &&
          typeof message.message === 'string' &&
          message.message.includes('Unsupported URI scheme: untitled')
      )
    );

    panel.dispose();
  });
});

test('custom editor provider posts exact shape updates after incomplete previews', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      vscode.__state.configuration.maxRows = 1;
      const csvPath = path.join(tempDir, 'shape.csv');
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
            message.payload?.shape === null
        )
      );
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'shape' &&
            message.shape?.rowCount === 3
        )
      );
      const previousDataCount = countMessages(panel.webview.messages, 'data');
      panel.webview.receive({ type: 'ready' });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.shape !== null &&
            countMessages(panel.webview.messages, 'data') > previousDataCount
        )
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
