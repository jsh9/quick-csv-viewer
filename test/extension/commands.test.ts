import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  FakeTabInputCustom,
  FakeTabInputText,
  FakeTabInputTextDiff,
  FakeUri,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

test('open command validates CSV files and opens valid resources with the custom editor', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    extension.activate({
      extensionUri: new FakeUri('/tmp/extension'),
      subscriptions: []
    });
    const openCommand = vscode.__state.commands.get(
      'quickCsvViewer.openCurrentFile'
    );
    assert.ok(openCommand);

    await openCommand?.(new FakeUri('/tmp/not-csv.txt'));
    assert.deepEqual(vscode.__state.warnings, [
      'Quick CSV Viewer can only open .csv files.'
    ]);

    const csvUri = new FakeUri('/tmp/data.csv');
    await openCommand?.(csvUri);
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.openWith',
      csvUri,
      'quickCsvViewer.viewer',
      vscode.ViewColumn.Active
    ]);
  });
});

test('open command resolves the active editor or tab when no resource is passed', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    extension.activate({
      extensionUri: new FakeUri('/tmp/extension'),
      subscriptions: []
    });
    const openCommand = vscode.__state.commands.get(
      'quickCsvViewer.openCurrentFile'
    );
    assert.ok(openCommand);

    await openCommand?.();
    assert.deepEqual(vscode.__state.warnings, [
      'Open a CSV file before running Quick CSV Viewer.'
    ]);

    const activeUri = new FakeUri('/tmp/active.csv');
    vscode.window.activeTextEditor = { document: { uri: activeUri } };
    await openCommand?.();
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.openWith',
      activeUri,
      'quickCsvViewer.viewer',
      vscode.ViewColumn.Active
    ]);

    vscode.window.activeTextEditor = undefined;
    const textTabUri = new FakeUri('/tmp/text-tab.csv');
    vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: new FakeTabInputText(textTabUri)
    };
    await openCommand?.();
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.openWith',
      textTabUri,
      'quickCsvViewer.viewer',
      vscode.ViewColumn.Active
    ]);

    const customTabUri = new FakeUri('/tmp/custom.csv');
    vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: new FakeTabInputCustom(customTabUri)
    };
    await openCommand?.();
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.openWith',
      customTabUri,
      'quickCsvViewer.viewer',
      vscode.ViewColumn.Active
    ]);

    const explicitUri = new FakeUri('/tmp/direct.csv');
    const originalUri = new FakeUri('/tmp/original.csv');
    const diffUri = new FakeUri('/tmp/diff.csv');
    vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: new FakeTabInputTextDiff(originalUri, diffUri)
    };
    await openCommand?.();
    assert.equal(
      vscode.__state.warnings.at(-1),
      'Quick CSV Viewer is not available in diff editors.'
    );
    assert.equal(vscode.__state.executedCommands.length, 3);

    await openCommand?.(explicitUri);
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.openWith',
      explicitUri,
      'quickCsvViewer.viewer',
      vscode.ViewColumn.Active
    ]);
  });
});

test('sample command opens existing bundled sample CSV files and warns when none exist', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-samples-')
    );

    try {
      await fs.mkdir(path.join(tempDir, 'sample-data'));
      const firstSample = path.join(tempDir, 'sample-data', 'sample-data.csv');
      const secondSample = path.join(
        tempDir,
        'sample-data',
        'small-ragged-unicode.csv'
      );
      await fs.writeFile(firstSample, 'a\n1', 'utf8');
      await fs.writeFile(secondSample, 'b\n2', 'utf8');
      extension.activate({
        extensionUri: new FakeUri(tempDir),
        subscriptions: []
      });
      const sampleCommand = vscode.__state.commands.get(
        'quickCsvViewer.openSampleFiles'
      );
      assert.ok(sampleCommand);

      await sampleCommand?.();
      await waitFor(() => vscode.__state.executedCommands.length === 2);
      assert.deepEqual(vscode.__state.executedCommands.slice(-2), [
        [
          'vscode.openWith',
          new FakeUri(firstSample),
          'quickCsvViewer.viewer',
          vscode.ViewColumn.One
        ],
        [
          'vscode.openWith',
          new FakeUri(secondSample),
          'quickCsvViewer.viewer',
          vscode.ViewColumn.Beside
        ]
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-empty-samples-')
    );

    try {
      extension.activate({
        extensionUri: new FakeUri(tempDir),
        subscriptions: []
      });
      const sampleCommand = vscode.__state.commands.get(
        'quickCsvViewer.openSampleFiles'
      );
      assert.ok(sampleCommand);

      await sampleCommand?.();
      await waitFor(() => vscode.__state.warnings.length === 1);
      assert.deepEqual(vscode.__state.warnings, [
        'No sample CSV files found. Run python3 sample-data/generate_large_csv.py first.'
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
