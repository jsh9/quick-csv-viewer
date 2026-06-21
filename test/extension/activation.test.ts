import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  Disposable,
  FakeUri,
  waitFor,
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
    extension.deactivate();
  });
});

test('extension activation reports command handler errors', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    extension.activate({
      extensionUri: new FakeUri('/tmp/extension'),
      subscriptions: []
    });
    vscode.__state.executeCommandError = new Error('open failed');

    const openCommand = vscode.__state.commands.get(
      'quickCsvViewer.openCurrentFile'
    );
    assert.ok(openCommand);
    openCommand?.(new FakeUri('/tmp/data.csv'));

    await waitFor(() =>
      vscode.__state.errors.some((message) =>
        message.includes(
          'Quick CSV Viewer failed to open the file: open failed'
        )
      )
    );
  });

  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-activation-')
    );

    try {
      await fs.mkdir(path.join(tempDir, 'sample-data'));
      await fs.writeFile(
        path.join(tempDir, 'sample-data', 'sample-data.csv'),
        'a\n1',
        'utf8'
      );
      extension.activate({
        extensionUri: new FakeUri(tempDir),
        subscriptions: []
      });
      vscode.__state.executeCommandError = new Error('sample failed');

      const sampleCommand = vscode.__state.commands.get(
        'quickCsvViewer.openSampleFiles'
      );
      assert.ok(sampleCommand);
      sampleCommand?.();

      await waitFor(() =>
        vscode.__state.errors.some((message) =>
          message.includes(
            'Quick CSV Viewer failed to open sample files: sample failed'
          )
        )
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
