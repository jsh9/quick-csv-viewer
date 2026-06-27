import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFakeWebviewPanel,
  FakeTabInputTextDiff,
  FakeUri,
  getRegisteredProvider,
  withMockedExtension
} from '../support/extension-host';

test('custom editor provider opens requested files even when a matching diff is active', async () => {
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

    // Verifies the provider honors the document it is asked to resolve instead
    // of inferring intent from active diff state. This protects explicit viewer
    // opens while VS Code's diff editor association handles automatic diff
    // routing before the provider is invoked.
    await provider.resolveCustomEditor(modifiedDocument, modifiedPanel, {});

    assert.equal(modifiedPanel.disposed, false);
    assert.equal(modifiedPanel.webview.options.enableScripts, true);
    assert.match(modifiedPanel.webview.html, /id="content"/);
    assert.equal(vscode.__state.executedCommands.length, 0);
    modifiedPanel.dispose();

    const originalDocument = await provider.openCustomDocument(originalUri);
    const originalPanel = createFakeWebviewPanel(undefined);

    await provider.resolveCustomEditor(originalDocument, originalPanel, {});

    assert.equal(originalPanel.disposed, false);
    assert.equal(originalPanel.webview.options.enableScripts, true);
    assert.match(originalPanel.webview.html, /id="content"/);
    assert.equal(vscode.__state.executedCommands.length, 0);
    originalPanel.dispose();
  });
});
