import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  createFakeWebviewPanel,
  FakeUri,
  getRegisteredProvider,
  hasMessageType,
  isMessage,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

test('custom editor provider reports load, settings, and exact-shape errors', async () => {
  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        extension.activate({
          extensionUri: new FakeUri('/tmp/extension'),
          subscriptions: []
        });
        const provider = getRegisteredProvider(vscode).provider;
        const missingUri = new FakeUri(path.join(tempDir, 'missing.csv'));
        const missingDocument = await provider.openCustomDocument(missingUri);
        const missingPanel = createFakeWebviewPanel(vscode.ViewColumn.Active);

        await provider.resolveCustomEditor(missingDocument, missingPanel, {});
        missingPanel.webview.receive({ type: 'ready' });
        await waitFor(() =>
          missingPanel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'error' &&
              typeof message.message === 'string' &&
              message.message.includes('ENOENT')
          )
        );
        missingPanel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      nodeFsOverrides: {
        watch: () => {
          throw new Error('watch unavailable');
        }
      }
    }
  );

  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      const csvPath = path.join(tempDir, 'settings-error.csv');
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
      await waitFor(() => hasMessageType(panel.webview.messages, 'data'));

      vscode.__state.configurationUpdateError = 'update failed';
      panel.webview.receive({ type: 'updateMaxRows', value: 5 });
      panel.webview.receive({
        type: 'updateFirstRowIsHeader',
        value: false
      });
      panel.webview.receive({
        type: 'updateWrapCellContents',
        value: false
      });
      await waitFor(
        () =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'maxRowsError' &&
              message.message === 'update failed'
          ) &&
          panel.webview.messages.filter(
            (message) =>
              isMessage(message) &&
              message.type === 'settingsError' &&
              message.message === 'update failed'
          ).length >= 2
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 1;
        const csvPath = path.join(tempDir, 'shape-error.csv');
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
              message.type === 'shapeError' &&
              message.message === 'shape failed'
          )
        );

        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        scanCsvShape: async () => {
          throw new Error('shape failed');
        }
      }
    }
  );
});
