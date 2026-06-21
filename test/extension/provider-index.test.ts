import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
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
