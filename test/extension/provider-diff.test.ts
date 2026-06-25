import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  createFakeWebviewPanel,
  FakeTabInputTextDiff,
  FakeUri,
  getRegisteredProvider,
  withMockedExtension
} from '../support/extension-host';

test('custom editor provider reopens matching active text diffs with VS Code diff editor', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    extension.activate({
      extensionUri: new FakeUri('/tmp/extension'),
      subscriptions: []
    });
    const provider = getRegisteredProvider(vscode).provider;
    const originalUri = new FakeUri('/tmp/original.csv');
    const modifiedUri = new FakeUri('/tmp/modified.csv');
    vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: new FakeTabInputTextDiff(originalUri, modifiedUri)
    };

    const modifiedDocument = await provider.openCustomDocument(modifiedUri);
    const modifiedPanel = createFakeWebviewPanel(vscode.ViewColumn.Beside);

    // Verifies either side of the active diff is handed back to VS Code's
    // native diff editor, because a table viewer cannot represent both sides.
    await provider.resolveCustomEditor(modifiedDocument, modifiedPanel, {});

    assert.equal(modifiedPanel.disposed, true);
    assert.equal(modifiedPanel.webview.html, '');
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.diff',
      originalUri,
      modifiedUri,
      undefined,
      { viewColumn: vscode.ViewColumn.Beside }
    ]);

    const originalDocument = await provider.openCustomDocument(originalUri);
    const originalPanel = createFakeWebviewPanel(undefined);

    // Also covers the original side and the fallback view column so the
    // escape hatch preserves native diff placement in both entry paths.
    await provider.resolveCustomEditor(originalDocument, originalPanel, {});

    assert.equal(originalPanel.disposed, true);
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.diff',
      originalUri,
      modifiedUri,
      undefined,
      { viewColumn: vscode.ViewColumn.Active }
    ]);
  });
});

test('custom editor provider ignores unrelated active text diffs', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-provider-diff-')
    );

    try {
      extension.activate({
        extensionUri: new FakeUri('/tmp/extension'),
        subscriptions: []
      });
      const provider = getRegisteredProvider(vscode).provider;
      vscode.window.tabGroups.activeTabGroup.activeTab = {
        input: new FakeTabInputTextDiff(
          new FakeUri(path.join(tempDir, 'original.csv')),
          new FakeUri(path.join(tempDir, 'modified.csv'))
        )
      };
      const uri = new FakeUri(path.join(tempDir, 'viewer.csv'));
      const document = await provider.openCustomDocument(uri);
      const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

      // Verifies unrelated diff state does not disable ordinary CSV opens.
      // The provider should only escape when the diff contains this document.
      await provider.resolveCustomEditor(document, panel, {});

      assert.equal(panel.disposed, false);
      assert.equal(panel.webview.options.enableScripts, true);
      assert.match(panel.webview.html, /id="content"/);
      assert.equal(vscode.__state.executedCommands.length, 0);

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
