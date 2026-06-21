import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { indexCsvFile as realIndexCsvFile } from '../../src/csv';
import {
  createFakeWebviewPanel,
  FakeUri,
  getRegisteredProvider,
  isMessage,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

test('custom editor provider serves virtual rows for indexed full-file views', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      vscode.__state.configuration.maxRows = 0;
      const csvPath = path.join(tempDir, 'full.csv');
      await fs.writeFile(csvPath, 'a,b\n1,2\n3,4\n5,6', 'utf8');
      extension.activate({
        extensionUri: new FakeUri('/tmp/extension'),
        subscriptions: []
      });
      const provider = getRegisteredProvider(vscode).provider;
      const uri = new FakeUri(csvPath);
      const document = await provider.openCustomDocument(uri);
      const panel = createFakeWebviewPanel(vscode.ViewColumn.Beside);

      await provider.resolveCustomEditor(document, panel, {});
      panel.webview.receive({ type: 'ready' });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) => isMessage(message) && message.type === 'fullIndexReady'
        )
      );

      panel.webview.receive({
        type: 'fetchRows',
        requestId: 'rows-1',
        start: Number.NaN,
        count: 2
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'rows' &&
            message.requestId === 'rows-1'
        )
      );

      const rowsMessage = panel.webview.messages.find(
        (message) =>
          isMessage(message) &&
          message.type === 'rows' &&
          message.requestId === 'rows-1'
      );
      assert.ok(isMessage(rowsMessage));
      assert.deepEqual(rowsMessage.payload?.rows, [
        { rowNumber: 1, cells: ['1', '2'] },
        { rowNumber: 2, cells: ['3', '4'] }
      ]);
      assert.equal(rowsMessage.payload?.totalRows, 3);

      panel.webview.receive({
        type: 'fetchRows',
        start: 1,
        count: Number.POSITIVE_INFINITY
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'rows' &&
            message.requestId === ''
        )
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('custom editor provider reports virtual row fetch errors', async () => {
  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 0;
        const csvPath = path.join(tempDir, 'row-error.csv');
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
        panel.webview.receive({ type: 'ready' });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) => isMessage(message) && message.type === 'fullIndexReady'
          )
        );

        panel.webview.receive({
          type: 'fetchRows',
          requestId: 'rows-error',
          start: 0,
          count: 1
        });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'error' &&
              message.message === 'rows failed'
          )
        );

        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        fetchCsvRows: async () => {
          throw new Error('rows failed');
        }
      }
    }
  );
});

test('custom editor provider starts exact shape scans for incomplete indexed views', async () => {
  let shapeScanCount = 0;
  let resolveShape:
    | ((shape: {
        readonly rowCount: number;
        readonly columnCount: number;
        readonly recordCount: number;
      }) => void)
    | undefined;

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 0;
        const csvPath = path.join(tempDir, 'incomplete-index.csv');
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
        panel.webview.receive({ type: 'ready' });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) => isMessage(message) && message.type === 'fullIndexReady'
          )
        );
        panel.webview.receive({
          type: 'fetchRows',
          requestId: 'before-shape',
          start: 0,
          count: 1
        });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'rows' &&
              message.requestId === 'before-shape'
          )
        );

        assert.equal(shapeScanCount, 1);
        resolveShape?.({
          rowCount: 2,
          columnCount: 2,
          recordCount: 3
        });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) => isMessage(message) && message.type === 'shape'
          )
        );
        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        indexCsvFile: async (
          filePath: string,
          options: Parameters<typeof realIndexCsvFile>[1]
        ) => ({
          ...(await realIndexCsvFile(filePath, options)),
          isComplete: false
        }),
        scanCsvShape: async () => {
          shapeScanCount += 1;
          return new Promise((resolve) => {
            resolveShape = resolve;
          });
        }
      },
      nodeFsOverrides: {
        watch: () => {
          throw new Error('watch disabled for exact-shape scan test');
        }
      }
    }
  );
});

test('custom editor provider ignores stale indexed progress and completion', async () => {
  let firstIndexOptions: Parameters<typeof realIndexCsvFile>[1] | undefined;
  let resolveFirstIndex:
    | ((index: Awaited<ReturnType<typeof realIndexCsvFile>>) => void)
    | undefined;
  let indexCallCount = 0;

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 0;
        const csvPath = path.join(tempDir, 'stale-index.csv');
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
        panel.webview.receive({ type: 'ready' });
        await waitFor(() => Boolean(resolveFirstIndex));

        panel.webview.receive({
          type: 'updateFirstRowIsHeader',
          value: false
        });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'fullIndexReady' &&
              message.payload?.firstRowIsHeader === false
          )
        );

        const progressCount = panel.webview.messages.filter(
          (message) =>
            isMessage(message) && message.type === 'fullIndexProgress'
        ).length;
        const readyCount = panel.webview.messages.filter(
          (message) => isMessage(message) && message.type === 'fullIndexReady'
        ).length;
        firstIndexOptions?.onProgress?.({
          bytesRead: 1,
          totalBytes: 1,
          percent: 100,
          indexedRecordCount: 1,
          columnCount: 1
        });
        resolveFirstIndex?.({
          fileSize: 1,
          recordOffsets: [],
          indexedRecordCount: 0,
          indexedEndOffset: 0,
          isComplete: true,
          maxColumnCount: 0
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(
          panel.webview.messages.filter(
            (message) =>
              isMessage(message) && message.type === 'fullIndexProgress'
          ).length,
          progressCount
        );
        assert.equal(
          panel.webview.messages.filter(
            (message) => isMessage(message) && message.type === 'fullIndexReady'
          ).length,
          readyCount
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
          options: Parameters<typeof realIndexCsvFile>[1]
        ) => {
          indexCallCount += 1;
          if (indexCallCount === 1) {
            firstIndexOptions = options;
            return new Promise((resolve) => {
              resolveFirstIndex = resolve;
            });
          }

          return realIndexCsvFile(filePath, options);
        }
      }
    }
  );
});
