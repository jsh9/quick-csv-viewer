import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Disposable,
  FakeUri,
  withMockedExtension
} from '../support/extension-host';

test('extension activation registers commands and the custom CSV editor provider', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const context = {
      extensionUri: new FakeUri('/tmp/extension'),
      subscriptions: [] as Disposable[]
    };

    extension.activate(context);

    assert.ok(vscode.__state.commands.has('quickCsvViewer.openCurrentFile'));
    assert.ok(vscode.__state.commands.has('quickCsvViewer.openSampleFiles'));
    assert.equal(vscode.__state.provider?.viewType, 'quickCsvViewer.viewer');
    assert.deepEqual(vscode.__state.provider?.options, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: {
        enableFindWidget: true,
        retainContextWhenHidden: true
      }
    });
    assert.equal(context.subscriptions.length, 3);
  });
});
