import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  createFakeWebviewPanel,
  FakeUri,
  getRegisteredProvider,
  withMockedExtension
} from '../support/extension-host';

test('raw contents command falls back to the active column when the panel has none', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      const csvPath = path.join(tempDir, 'raw-fallback.csv');
      await fs.writeFile(csvPath, 'a,b\n1,2', 'utf8');
      extension.activate({
        extensionUri: new FakeUri('/tmp/extension'),
        subscriptions: []
      });
      const provider = getRegisteredProvider(vscode).provider;
      const uri = new FakeUri(csvPath);
      const document = await provider.openCustomDocument(uri);
      const panel = createFakeWebviewPanel(undefined);

      await provider.resolveCustomEditor(document, panel, {});
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
