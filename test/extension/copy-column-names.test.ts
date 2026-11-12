import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { formatBulletedList, isStringArray } from '../../src/extension/utils';
import {
  countMessages,
  createFakeWebviewPanel,
  FakeUri,
  type FakeWebviewPanel,
  getRegisteredProvider,
  isMessage,
  type VscodeMock,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

test('column names are formatted as a bulleted list with one line per name', () => {
  assert.equal(formatBulletedList([]), '');
  assert.equal(formatBulletedList(['id']), '• id');
  assert.equal(
    formatBulletedList(['id', 'first\nname', 'notes\r\nmore\rtext', '']),
    '• id\n• first name\n• notes more text\n• '
  );
});

test('string arrays are recognized only when every item is text', () => {
  assert.equal(isStringArray([]), true);
  assert.equal(isStringArray(['a', '']), true);
  assert.equal(isStringArray('a'), false);
  assert.equal(isStringArray(undefined), false);
  assert.equal(isStringArray(['a', 1]), false);
});

test('copy column names writes a bulleted list to the clipboard', async () => {
  await withCopyPanel(async ({ vscode, panel }) => {
    panel.webview.receive({
      type: 'copyColumnNames',
      value: ['id', 'full\nname', 'email']
    });

    const copied = await waitForMessage(panel, 'columnNamesCopied');
    assert.equal(copied.count, 3);
    assert.equal(vscode.__state.clipboardText, '• id\n• full name\n• email');
  });
});

test('copy column names rejects malformed payloads without touching the clipboard', async () => {
  await withCopyPanel(async ({ vscode, panel }) => {
    panel.webview.receive({ type: 'copyColumnNames', value: 'id,name' });
    const error = await waitForMessage(panel, 'copyColumnNamesError');
    assert.equal(error.message, 'Column names must be a list of text values.');

    panel.webview.receive({ type: 'copyColumnNames', value: ['id', 7] });
    await waitFor(
      () => countMessages(panel.webview.messages, 'copyColumnNamesError') === 2
    );
    assert.equal(vscode.__state.clipboardText, undefined);
  });
});

test('copy column names reports clipboard failures to the webview', async () => {
  await withCopyPanel(async ({ vscode, panel }) => {
    vscode.__state.clipboardWriteError = new Error('Clipboard unavailable.');
    panel.webview.receive({ type: 'copyColumnNames', value: ['id'] });

    const error = await waitForMessage(panel, 'copyColumnNamesError');
    assert.equal(error.message, 'Clipboard unavailable.');
    assert.equal(countMessages(panel.webview.messages, 'columnNamesCopied'), 0);
  });
});

async function withCopyPanel(
  run: (context: {
    readonly vscode: VscodeMock;
    readonly panel: FakeWebviewPanel;
  }) => Promise<void>
): Promise<void> {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      const csvPath = path.join(tempDir, 'columns.csv');
      await fs.writeFile(csvPath, 'id,name\n1,Ada', 'utf8');
      extension.activate({
        extensionUri: new FakeUri('/tmp/extension'),
        subscriptions: []
      });
      const provider = getRegisteredProvider(vscode).provider;
      const document = await provider.openCustomDocument(new FakeUri(csvPath));
      const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

      await provider.resolveCustomEditor(document, panel, {});
      try {
        await run({ vscode, panel });
      } finally {
        panel.dispose();
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}

async function waitForMessage(
  panel: FakeWebviewPanel,
  type: string
): Promise<{ readonly count?: unknown; readonly message?: unknown }> {
  await waitFor(() => countMessages(panel.webview.messages, type) > 0);
  const message = panel.webview.messages.find(
    (candidate) => isMessage(candidate) && candidate.type === type
  );
  assert.ok(isMessage(message));
  return message;
}
