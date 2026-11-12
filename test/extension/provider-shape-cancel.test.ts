import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  fetchCsvHeaders as realFetchCsvHeaders,
  scanCsvShape as realScanCsvShape
} from '../../src/csv';
import {
  createFakeWebviewPanel,
  type FakeWebviewPanel,
  FakeUri,
  getRegisteredProvider,
  hasMessageType,
  isMessage,
  makeAbortError,
  sleep,
  type VscodeMock,
  waitFor,
  withMockedExtension
} from '../support/extension-host';

type ScanOptions = Parameters<typeof realScanCsvShape>[1];
type IndexOptions = { readonly signal?: AbortSignal };

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Keeps the row index pending until the load is aborted, so the test can act
// while the webview is in its indexing state.
function pendingIndex(
  _filePath: string,
  options: IndexOptions
): Promise<never> {
  return new Promise((_resolve, reject) => {
    options.signal?.addEventListener(
      'abort',
      () => {
        reject(makeAbortError());
      },
      { once: true }
    );
  });
}

function shapeRowCounts(messages: readonly unknown[]): number[] {
  return messages.flatMap((message) =>
    isMessage(message) &&
    message.type === 'shape' &&
    typeof message.shape?.rowCount === 'number'
      ? [message.shape.rowCount]
      : []
  );
}

function messageTypes(messages: readonly unknown[]): unknown[] {
  return messages.map((message) => (isMessage(message) ? message.type : null));
}

async function openViewer(
  run: (context: {
    readonly vscode: VscodeMock;
    readonly panel: FakeWebviewPanel;
  }) => Promise<void>,
  csvOverrides: Record<string, unknown>
): Promise<void> {
  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        const csvPath = path.join(tempDir, 'shape-cancel.csv');
        await fs.writeFile(
          csvPath,
          [
            'a,b',
            ...Array.from({ length: 5_000 }, (_, index) => `${index},v${index}`)
          ].join('\n'),
          'utf8'
        );
        extension.activate({
          extensionUri: new FakeUri('/tmp/extension'),
          subscriptions: []
        });
        const provider = getRegisteredProvider(vscode).provider;
        const document = await provider.openCustomDocument(
          new FakeUri(csvPath)
        );
        const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);
        await provider.resolveCustomEditor(document, panel, {});
        panel.webview.receive({ type: 'ready' });
        await waitFor(() => hasMessageType(panel.webview.messages, 'data'));

        try {
          await run({ vscode, panel });
        } finally {
          panel.dispose();
        }
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    { csvOverrides }
  );
}

test('cancelling after a mid-index shape re-sends the shape for the restored view', async () => {
  const scanGate = deferred();
  await openViewer(
    async ({ panel }) => {
      const messages = panel.webview.messages;
      panel.webview.receive({ type: 'updateMaxRows', value: 0 });
      await waitFor(() => hasMessageType(messages, 'fullIndexStart'));

      scanGate.resolve();
      await waitFor(() => shapeRowCounts(messages).length === 1);
      const mark = messages.length;
      panel.webview.receive({ type: 'cancelLoad' });
      await waitFor(() => shapeRowCounts(messages.slice(mark)).length === 1);

      const afterCancel = messages.slice(mark);
      assert.deepEqual(messageTypes(afterCancel), [
        'restorePreviousView',
        'shape'
      ]);
      assert.deepEqual(shapeRowCounts(afterCancel), [5_000]);
    },
    {
      scanCsvShape: async (filePath: string, options: ScanOptions) => {
        await scanGate.promise;
        return realScanCsvShape(filePath, options);
      },
      indexCsvFile: pendingIndex
    }
  );
});

test('the re-sent shape uses the restored view header setting', async () => {
  const scanGate = deferred();
  await openViewer(
    async ({ vscode, panel }) => {
      const messages = panel.webview.messages;
      // One reload that both turns the header row off and switches to the
      // indexed view, as a settings sync could.
      vscode.__state.configuration.firstRowIsHeader = false;
      vscode.__state.configuration.maxRows = 0;
      for (const listener of vscode.__state.configurationListeners) {
        listener({
          affectsConfiguration: (name) => name === 'quickCsvViewer.maxRows'
        });
      }
      await waitFor(() => hasMessageType(messages, 'fullIndexStart'));

      scanGate.resolve();
      await waitFor(() => shapeRowCounts(messages).length === 1);
      // Header off: the header record counts as a data row.
      assert.deepEqual(shapeRowCounts(messages), [5_001]);

      const mark = messages.length;
      panel.webview.receive({ type: 'cancelLoad' });
      await waitFor(() => shapeRowCounts(messages.slice(mark)).length === 1);
      assert.deepEqual(shapeRowCounts(messages.slice(mark)), [5_000]);
      await waitFor(
        () => vscode.__state.configuration.firstRowIsHeader === true
      );
    },
    {
      scanCsvShape: async (filePath: string, options: ScanOptions) => {
        await scanGate.promise;
        return realScanCsvShape(filePath, options);
      },
      indexCsvFile: pendingIndex
    }
  );
});

test('cancelling without a cached shape restarts a failed shape scan', async () => {
  let scanCalls = 0;
  await openViewer(
    async ({ panel }) => {
      const messages = panel.webview.messages;
      await waitFor(() => hasMessageType(messages, 'shapeError'));
      assert.equal(scanCalls, 1);

      panel.webview.receive({ type: 'updateMaxRows', value: 0 });
      await waitFor(() => hasMessageType(messages, 'fullIndexStart'));
      const mark = messages.length;
      panel.webview.receive({ type: 'cancelLoad' });

      await waitFor(() => shapeRowCounts(messages.slice(mark)).length === 1);
      assert.equal(scanCalls, 2);
      // The restarted scan may also report progress before it finishes.
      assert.deepEqual(
        messageTypes(messages.slice(mark)).filter(
          (type) => type !== 'shapeProgress'
        ),
        ['restorePreviousView', 'shape']
      );
      assert.deepEqual(shapeRowCounts(messages.slice(mark)), [5_000]);
    },
    {
      scanCsvShape: async (filePath: string, options: ScanOptions) => {
        scanCalls += 1;
        if (scanCalls === 1) {
          throw new Error('disk hiccup');
        }

        return realScanCsvShape(filePath, options);
      },
      indexCsvFile: pendingIndex
    }
  );
});

test('cancelling while headers are read does not post a stale fullIndexReady', async () => {
  const headersGate = deferred();
  let headerCalls = 0;
  await openViewer(
    async ({ panel }) => {
      const messages = panel.webview.messages;
      panel.webview.receive({ type: 'updateMaxRows', value: 500 });
      await waitFor(() => headerCalls === 1);

      const mark = messages.length;
      panel.webview.receive({ type: 'cancelLoad' });
      await waitFor(() =>
        hasMessageType(messages.slice(mark), 'restorePreviousView')
      );
      headersGate.resolve();
      await sleep(50);

      assert.equal(
        hasMessageType(messages.slice(mark), 'fullIndexReady'),
        false
      );
    },
    {
      scanCsvShape: () => new Promise(() => {}),
      fetchCsvHeaders: async (
        ...args: Parameters<typeof realFetchCsvHeaders>
      ) => {
        headerCalls += 1;
        await headersGate.promise;
        return realFetchCsvHeaders(...args);
      }
    }
  );
});

test('fullIndexReady includes a shape that finished while headers were read', async () => {
  const scanGate = deferred();
  const headersGate = deferred();
  let headerCalls = 0;
  await openViewer(
    async ({ panel }) => {
      const messages = panel.webview.messages;
      // 500 rows uses an indexed preview whose index stops early, so the
      // index itself cannot supply the exact shape.
      panel.webview.receive({ type: 'updateMaxRows', value: 500 });
      await waitFor(() => headerCalls === 1);

      scanGate.resolve();
      await waitFor(() => shapeRowCounts(messages).length === 1);
      headersGate.resolve();
      await waitFor(() => hasMessageType(messages, 'fullIndexReady'));

      const ready = messages.find(
        (message) => isMessage(message) && message.type === 'fullIndexReady'
      );
      assert.ok(isMessage(ready));
      assert.deepEqual(ready.payload?.shape, {
        rowCount: 5_000,
        columnCount: 2,
        recordCount: 5_001
      });
    },
    {
      scanCsvShape: async (filePath: string, options: ScanOptions) => {
        await scanGate.promise;
        return realScanCsvShape(filePath, options);
      },
      fetchCsvHeaders: async (
        ...args: Parameters<typeof realFetchCsvHeaders>
      ) => {
        headerCalls += 1;
        await headersGate.promise;
        return realFetchCsvHeaders(...args);
      }
    }
  );
});
