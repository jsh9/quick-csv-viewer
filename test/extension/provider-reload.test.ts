import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  countMessages,
  createFakeWebviewPanel,
  FakeUri,
  FakeWebviewPanel,
  getRegisteredProvider,
  hasMessageType,
  isMessage,
  makeAbortError,
  sleep,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

test('custom editor provider reloads open viewers after matching file save events', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      const csvPath = path.join(tempDir, 'reload.csv');
      await fs.writeFile(csvPath, 'a,b\n1,2', 'utf8');
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
            message.payload?.preview?.rows?.[0]?.cells?.[0] === '1'
        )
      );

      const previousDataCount = panel.webview.messages.filter(
        (message) => isMessage(message) && message.type === 'data'
      ).length;
      await fs.writeFile(csvPath, 'a,b\n9,10', 'utf8');
      for (const listener of vscode.__state.saveListeners) {
        listener({ uri });
      }

      await waitFor(
        () =>
          panel.webview.messages.filter(
            (message) => isMessage(message) && message.type === 'data'
          ).length > previousDataCount
      );
      assert.ok(
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.preview?.rows?.[0]?.cells?.[0] === '9'
        )
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('custom editor provider debounces matching external file changes and ignores unrelated saves', async () => {
  let watchCallback:
    | ((eventType: string, changedFileName?: string | Buffer) => void)
    | undefined;
  let closeCount = 0;

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        const csvPath = path.join(tempDir, 'watch.csv');
        await fs.writeFile(csvPath, 'a,b\n1,2', 'utf8');
        extension.activate({
          extensionUri: new FakeUri('/tmp/extension'),
          subscriptions: []
        });
        const provider = getRegisteredProvider(vscode).provider;
        const uri = new FakeUri(csvPath);
        const document = await provider.openCustomDocument(uri);
        const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

        await provider.resolveCustomEditor(document, panel, {});
        for (const listener of vscode.__state.saveListeners) {
          listener({ uri });
        }
        panel.webview.receive({ type: 'ready' });
        await waitFor(() => hasMessageType(panel.webview.messages, 'data'));

        const initialDataCount = countMessages(panel.webview.messages, 'data');
        for (const listener of vscode.__state.saveListeners) {
          listener({ uri: new FakeUri(path.join(tempDir, 'other.csv')) });
        }
        watchCallback?.('change', 'other.csv');
        await sleep(200);
        assert.equal(
          countMessages(panel.webview.messages, 'data'),
          initialDataCount
        );

        await fs.writeFile(csvPath, 'a,b\n9,10', 'utf8');
        watchCallback?.('change', undefined);
        watchCallback?.('change', path.basename(csvPath));
        await waitFor(
          () => countMessages(panel.webview.messages, 'data') > initialDataCount
        );

        const reloadedDataCount = countMessages(panel.webview.messages, 'data');
        watchCallback?.('change', undefined);
        panel.dispose();
        await sleep(200);
        assert.equal(
          countMessages(panel.webview.messages, 'data'),
          reloadedDataCount
        );
        assert.equal(closeCount, 1);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      nodeFsOverrides: {
        watch: (
          _directory: string,
          callback: (
            eventType: string,
            changedFileName?: string | Buffer
          ) => void
        ) => {
          watchCallback = callback;
          const watcher = {
            on: () => watcher,
            close: () => {
              closeCount += 1;
            }
          };
          return watcher;
        }
      }
    }
  );
});

test('custom editor provider suppresses duplicate exact-shape scans for unchanged files', async () => {
  let shapeScanCount = 0;
  const shapeSignals: AbortSignal[] = [];

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );
      let panel: FakeWebviewPanel | undefined;

      try {
        vscode.__state.configuration.maxRows = 1;
        const csvPath = path.join(tempDir, 'pending-shape.csv');
        await fs.writeFile(csvPath, 'a,b\n1,2\n3,4\n5,6', 'utf8');
        extension.activate({
          extensionUri: new FakeUri('/tmp/extension'),
          subscriptions: []
        });
        const provider = getRegisteredProvider(vscode).provider;
        const uri = new FakeUri(csvPath);
        const document = await provider.openCustomDocument(uri);
        panel = createFakeWebviewPanel(vscode.ViewColumn.Active);
        const activePanel = panel;

        await provider.resolveCustomEditor(document, activePanel, {});
        activePanel.webview.receive({ type: 'ready' });
        await waitFor(() => shapeScanCount === 1);
        const initialDataCount = countMessages(
          activePanel.webview.messages,
          'data'
        );

        activePanel.webview.receive({ type: 'ready' });
        await waitFor(
          () =>
            countMessages(activePanel.webview.messages, 'data') >
            initialDataCount
        );
        assert.equal(shapeScanCount, 1);
      } finally {
        panel?.dispose();
        if (shapeSignals.length > 0) {
          assert.equal(shapeSignals[0]?.aborted, true);
        }
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      nodeFsOverrides: {
        watch: () => {
          const watcher = {
            on: () => watcher,
            close: () => undefined
          };
          return watcher;
        }
      },
      csvOverrides: {
        scanCsvShape: (
          _filePath: string,
          options: { readonly signal?: AbortSignal }
        ) => {
          shapeScanCount += 1;
          shapeSignals.push(options.signal as AbortSignal);
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              'abort',
              () => reject(makeAbortError()),
              { once: true }
            );
          });
        }
      }
    }
  );
});
