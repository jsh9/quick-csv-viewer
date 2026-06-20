import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import Module from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  fetchCsvRows as realFetchCsvRows,
  indexCsvFile as realIndexCsvFile
} from '../src/csv';

interface Disposable {
  dispose(): void;
}

interface ExtensionModule {
  activate(context: {
    extensionUri?: FakeUri;
    subscriptions: Disposable[];
  }): void;
  deactivate(): void;
}

interface RegisteredProvider {
  viewType: string;
  provider: {
    openCustomDocument(uri: FakeUri): Promise<{
      readonly uri: FakeUri;
      dispose(): void;
    }>;
    resolveCustomEditor(
      document: { readonly uri: FakeUri; dispose(): void },
      webviewPanel: FakeWebviewPanel,
      token: unknown
    ): Promise<void>;
  };
  options: unknown;
}

interface VscodeMock {
  readonly commands: {
    registerCommand(
      command: string,
      callback: (resource?: FakeUri) => unknown
    ): Disposable;
    executeCommand(...args: unknown[]): Promise<void>;
  };
  readonly window: {
    activeTextEditor?: { document: { uri: FakeUri } };
    tabGroups: {
      activeTabGroup: {
        activeTab?: { input?: unknown };
      };
    };
    registerCustomEditorProvider(
      viewType: string,
      provider: RegisteredProvider['provider'],
      options: unknown
    ): Disposable;
    showWarningMessage(message: string): Promise<undefined>;
    showErrorMessage(message: string): Promise<undefined>;
  };
  readonly workspace: {
    getConfiguration(section: string): {
      get(key: string): unknown;
      update(key: string, value: unknown, target: unknown): Promise<void>;
    };
    onDidChangeConfiguration(
      listener: (event: { affectsConfiguration(name: string): boolean }) => void
    ): Disposable;
    onDidSaveTextDocument(
      listener: (document: { uri: FakeUri }) => void
    ): Disposable;
  };
  readonly Uri: typeof FakeUri;
  readonly TabInputText: typeof FakeTabInputText;
  readonly TabInputCustom: typeof FakeTabInputCustom;
  readonly TabInputTextDiff: typeof FakeTabInputTextDiff;
  readonly ViewColumn: {
    readonly Active: number;
    readonly One: number;
    readonly Beside: number;
  };
  readonly ConfigurationTarget: {
    readonly Global: string;
  };
  readonly __state: {
    readonly commands: Map<string, (resource?: FakeUri) => unknown>;
    readonly executedCommands: unknown[][];
    readonly warnings: string[];
    readonly errors: string[];
    readonly configuration: Record<string, unknown>;
    readonly configurationListeners: Array<
      (event: { affectsConfiguration(name: string): boolean }) => void
    >;
    readonly saveListeners: Array<(document: { uri: FakeUri }) => void>;
    configurationUpdateError?: unknown;
    provider?: RegisteredProvider;
  };
}

interface FakeWebview {
  options: Record<string, unknown>;
  html: string;
  readonly messages: unknown[];
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
  receive(message: unknown): void;
}

interface FakeWebviewPanel {
  readonly webview: FakeWebview;
  readonly viewColumn: number | undefined;
  readonly reveals: Array<{
    readonly column: number | undefined;
    readonly preserveFocus: boolean;
  }>;
  reveal(column: number | undefined, preserveFocus: boolean): void;
  onDidDispose(listener: () => void): Disposable;
  dispose(): void;
}

class FakeUri {
  public constructor(
    public readonly fsPath: string,
    public readonly scheme = 'file'
  ) {}

  public static joinPath(base: FakeUri, ...segments: string[]): FakeUri {
    return new FakeUri(path.join(base.fsPath, ...segments), base.scheme);
  }

  public toString(): string {
    return `${this.scheme}:${this.fsPath}`;
  }
}

class FakeTabInputText {
  public constructor(public readonly uri: FakeUri) {}
}

class FakeTabInputCustom {
  public constructor(public readonly uri: FakeUri) {}
}

class FakeTabInputTextDiff {
  public constructor(public readonly modified: FakeUri) {}
}

const moduleLoader = Module as unknown as {
  _load(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown;
};
const originalLoad = moduleLoader._load;

interface ExtensionTestOverrides {
  readonly csvOverrides?: Record<string, unknown>;
  readonly nodeFsOverrides?: Record<string, unknown>;
}

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

    const diffUri = new FakeUri('/tmp/diff.csv');
    vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: new FakeTabInputTextDiff(diffUri)
    };
    await openCommand?.();
    assert.deepEqual(vscode.__state.executedCommands.at(-1), [
      'vscode.openWith',
      diffUri,
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

test('custom editor provider loads limited previews and handles validation messages', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      const csvPath = path.join(tempDir, 'preview.csv');
      await fs.writeFile(csvPath, 'a,b\n1,2\n3,4', 'utf8');
      extension.activate({
        extensionUri: new FakeUri('/tmp/extension'),
        subscriptions: []
      });
      const provider = getRegisteredProvider(vscode).provider;
      const uri = new FakeUri(csvPath);
      const document = await provider.openCustomDocument(uri);
      const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

      await provider.resolveCustomEditor(document, panel, {});
      assert.equal(panel.webview.options.enableScripts, true);
      assert.match(panel.webview.html, /id="content"/);
      assert.deepEqual(panel.reveals, [
        { column: vscode.ViewColumn.Active, preserveFocus: false }
      ]);

      panel.webview.receive({ type: 'ready' });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.preview?.loadedRowCount === 2
        )
      );

      assert.ok(hasMessageType(panel.webview.messages, 'loading'));
      assert.ok(hasMessageType(panel.webview.messages, 'previewLoadStart'));
      panel.webview.receive({ type: 'updateMaxRows', value: -1 });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) => isMessage(message) && message.type === 'maxRowsError'
        )
      );
      panel.webview.receive({ type: 'updateMaxRows', value: '10' });
      await waitFor(
        () => countMessages(panel.webview.messages, 'maxRowsError') >= 2
      );

      panel.webview.receive({
        type: 'updateFirstRowIsHeader',
        value: 'yes'
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) => isMessage(message) && message.type === 'settingsError'
        )
      );

      panel.webview.receive({
        type: 'updateWrapCellContents',
        value: 'no'
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'settingsError' &&
            message.message === 'Wrap cells must be on or off.'
        )
      );

      panel.webview.receive({
        type: 'updateWrapCellContents',
        value: false
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'wrapCellContents' &&
            message.value === false
        )
      );

      panel.webview.receive({ type: 'updateMaxRows', value: 1 });
      await waitFor(() => vscode.__state.configuration.maxRows === 1);

      panel.webview.receive({
        type: 'updateFirstRowIsHeader',
        value: false
      });
      await waitFor(
        () => vscode.__state.configuration.firstRowIsHeader === false
      );

      panel.webview.receive({
        type: 'fetchRows',
        requestId: 'missing-index',
        start: 0,
        count: 1
      });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'error' &&
            message.message === 'The CSV row index is not ready yet.'
        )
      );

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

test('custom editor provider rejects unsupported URI schemes', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    extension.activate({
      extensionUri: new FakeUri('/tmp/extension'),
      subscriptions: []
    });
    const provider = getRegisteredProvider(vscode).provider;
    const uri = new FakeUri('/tmp/preview.csv', 'untitled');
    const document = await provider.openCustomDocument(uri);
    assert.equal(typeof document.dispose, 'function');
    document.dispose();
    const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitFor(() =>
      panel.webview.messages.some(
        (message) =>
          isMessage(message) &&
          message.type === 'error' &&
          typeof message.message === 'string' &&
          message.message.includes('Unsupported URI scheme: untitled')
      )
    );

    panel.dispose();
  });
});

test('custom editor provider posts exact shape updates after incomplete previews', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      vscode.__state.configuration.maxRows = 1;
      const csvPath = path.join(tempDir, 'shape.csv');
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
            message.type === 'data' &&
            message.payload?.shape === null
        )
      );
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'shape' &&
            message.shape?.rowCount === 3
        )
      );
      const previousDataCount = countMessages(panel.webview.messages, 'data');
      panel.webview.receive({ type: 'ready' });
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.shape !== null &&
            countMessages(panel.webview.messages, 'data') > previousDataCount
        )
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('custom editor provider cancels first loads back to a default limited preview', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      vscode.__state.configuration.maxRows = 0;
      const csvPath = path.join(tempDir, 'cancel-first.csv');
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
      const uri = new FakeUri(csvPath);
      const document = await provider.openCustomDocument(uri);
      const panel = createFakeWebviewPanel(vscode.ViewColumn.Active);

      await provider.resolveCustomEditor(document, panel, {});
      panel.webview.receive({ type: 'ready' });
      panel.webview.receive({ type: 'cancelLoad' });

      await waitFor(() => vscode.__state.configuration.maxRows === 20);
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.maxRows === 20 &&
            message.payload.preview?.loadedRowCount === 20
        )
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('custom editor provider reloads open viewers after matching file save events', async () => {
  await withMockedExtension(async ({ extension, vscode }) => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
    );

    try {
      const csvPath = path.join(tempDir, 'reload.csv');
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
      await waitFor(() =>
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.preview?.rows?.[0]?.cells?.[0] === '1'
        )
      );

      const previousDataCount = panel.webview.messages.filter(
        (message) => isMessage(message) && message.type === 'data'
      ).length;
      await fs.writeFile(csvPath, 'a,b\n9,10', 'utf8');
      for (const listener of vscode.__state.saveListeners) {
        listener({ uri });
      }

      await waitFor(
        () =>
          panel.webview.messages.filter(
            (message) => isMessage(message) && message.type === 'data'
          ).length > previousDataCount
      );
      assert.ok(
        panel.webview.messages.some(
          (message) =>
            isMessage(message) &&
            message.type === 'data' &&
            message.payload?.preview?.rows?.[0]?.cells?.[0] === '9'
        )
      );

      panel.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

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

test('custom editor provider restores the previous successful view when cancelling a later load', async () => {
  const pendingSignals: AbortSignal[] = [];

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 1;
        vscode.__state.configuration.firstRowIsHeader = true;
        const csvPath = path.join(tempDir, 'cancel-restore.csv');
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
              message.type === 'data' &&
              message.payload?.maxRows === 1
          )
        );

        panel.webview.receive({ type: 'updateMaxRows', value: 0 });
        await waitFor(() => pendingSignals.length === 1);
        panel.webview.receive({
          type: 'updateFirstRowIsHeader',
          value: false
        });
        await waitFor(() => pendingSignals.length === 2);
        assert.equal(pendingSignals[0]?.aborted, true);

        panel.webview.receive({ type: 'cancelLoad' });
        await waitFor(
          () =>
            vscode.__state.configuration.maxRows === 1 &&
            vscode.__state.configuration.firstRowIsHeader === true
        );
        assert.equal(pendingSignals[1]?.aborted, true);
        assert.ok(
          hasMessageType(panel.webview.messages, 'restorePreviousView')
        );

        vscode.__state.configuration.maxRows = 0;
        vscode.__state.configuration.firstRowIsHeader = false;
        panel.webview.receive({ type: 'cancelLoad' });
        await waitFor(
          () =>
            panel.webview.messages.filter(
              (message) =>
                isMessage(message) && message.type === 'restorePreviousView'
            ).length >= 2 &&
            vscode.__state.configuration.maxRows === 1 &&
            vscode.__state.configuration.firstRowIsHeader === true
        );

        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        indexCsvFile: (
          filePath: string,
          options: {
            readonly recordLimit?: number;
            readonly signal?: AbortSignal;
          }
        ) => {
          if (options.recordLimit === undefined) {
            pendingSignals.push(options.signal as AbortSignal);
            return new Promise((_resolve, reject) => {
              options.signal?.addEventListener(
                'abort',
                () => reject(makeAbortError()),
                { once: true }
              );
            });
          }

          return realIndexCsvFile(filePath, options);
        }
      }
    }
  );
});

test('custom editor provider restores indexed views and drops stale row responses after cancellation', async () => {
  let resolveHeldRows:
    | ((rows: Awaited<ReturnType<typeof realFetchCsvRows>>) => void)
    | undefined;
  let holdNextRows = true;

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        vscode.__state.configuration.maxRows = 0;
        const csvPath = path.join(tempDir, 'stale-rows.csv');
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
          hasMessageType(panel.webview.messages, 'fullIndexReady')
        );

        panel.webview.receive({
          type: 'fetchRows',
          requestId: 'stale',
          start: 0,
          count: 1
        });
        await waitFor(() => Boolean(resolveHeldRows));
        panel.webview.receive({ type: 'cancelLoad' });
        await waitFor(() =>
          hasMessageType(panel.webview.messages, 'restorePreviousView')
        );

        resolveHeldRows?.({
          start: 0,
          rows: [{ rowNumber: 1, cells: ['stale', 'row'] }],
          indexedDataRowCount: 3
        });
        await sleep(20);
        assert.equal(
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'rows' &&
              message.requestId === 'stale'
          ),
          false
        );

        panel.webview.receive({
          type: 'fetchRows',
          requestId: 'after-restore',
          start: 1,
          count: 1
        });
        await waitFor(() =>
          panel.webview.messages.some(
            (message) =>
              isMessage(message) &&
              message.type === 'rows' &&
              message.requestId === 'after-restore'
          )
        );

        const restoredRows = panel.webview.messages.find(
          (message) =>
            isMessage(message) &&
            message.type === 'rows' &&
            message.requestId === 'after-restore'
        );
        assert.ok(isMessage(restoredRows));
        assert.deepEqual(restoredRows.payload?.rows, [
          { rowNumber: 2, cells: ['3', '4'] }
        ]);

        panel.dispose();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      csvOverrides: {
        fetchCsvRows: (
          filePath: string,
          index: Parameters<typeof realFetchCsvRows>[1],
          options: Parameters<typeof realFetchCsvRows>[2]
        ) => {
          if (holdNextRows) {
            holdNextRows = false;
            return new Promise((resolve) => {
              resolveHeldRows = resolve;
            });
          }

          return realFetchCsvRows(filePath, index, options);
        }
      }
    }
  );
});

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

test('custom editor provider debounces matching external file changes and ignores unrelated saves', async () => {
  let watchCallback:
    | ((eventType: string, changedFileName?: string | Buffer) => void)
    | undefined;
  let closeCount = 0;

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );

      try {
        const csvPath = path.join(tempDir, 'watch.csv');
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
        for (const listener of vscode.__state.saveListeners) {
          listener({ uri });
        }
        panel.webview.receive({ type: 'ready' });
        await waitFor(() => hasMessageType(panel.webview.messages, 'data'));

        const initialDataCount = countMessages(panel.webview.messages, 'data');
        for (const listener of vscode.__state.saveListeners) {
          listener({ uri: new FakeUri(path.join(tempDir, 'other.csv')) });
        }
        watchCallback?.('change', 'other.csv');
        await sleep(200);
        assert.equal(
          countMessages(panel.webview.messages, 'data'),
          initialDataCount
        );

        await fs.writeFile(csvPath, 'a,b\n9,10', 'utf8');
        watchCallback?.('change', undefined);
        watchCallback?.('change', path.basename(csvPath));
        await waitFor(
          () => countMessages(panel.webview.messages, 'data') > initialDataCount
        );

        const reloadedDataCount = countMessages(panel.webview.messages, 'data');
        watchCallback?.('change', undefined);
        panel.dispose();
        await sleep(200);
        assert.equal(
          countMessages(panel.webview.messages, 'data'),
          reloadedDataCount
        );
        assert.equal(closeCount, 1);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      nodeFsOverrides: {
        watch: (
          _directory: string,
          callback: (
            eventType: string,
            changedFileName?: string | Buffer
          ) => void
        ) => {
          watchCallback = callback;
          const watcher = {
            on: () => watcher,
            close: () => {
              closeCount += 1;
            }
          };
          return watcher;
        }
      }
    }
  );
});

test('custom editor provider suppresses duplicate exact-shape scans for unchanged files', async () => {
  let shapeScanCount = 0;
  const shapeSignals: AbortSignal[] = [];

  await withMockedExtension(
    async ({ extension, vscode }) => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'quick-csv-viewer-extension-')
      );
      let panel: FakeWebviewPanel | undefined;

      try {
        vscode.__state.configuration.maxRows = 1;
        const csvPath = path.join(tempDir, 'pending-shape.csv');
        await fs.writeFile(csvPath, 'a,b\n1,2\n3,4\n5,6', 'utf8');
        extension.activate({
          extensionUri: new FakeUri('/tmp/extension'),
          subscriptions: []
        });
        const provider = getRegisteredProvider(vscode).provider;
        const uri = new FakeUri(csvPath);
        const document = await provider.openCustomDocument(uri);
        panel = createFakeWebviewPanel(vscode.ViewColumn.Active);
        const activePanel = panel;

        await provider.resolveCustomEditor(document, activePanel, {});
        activePanel.webview.receive({ type: 'ready' });
        await waitFor(() => shapeScanCount === 1);
        const initialDataCount = countMessages(
          activePanel.webview.messages,
          'data'
        );

        activePanel.webview.receive({ type: 'ready' });
        await waitFor(
          () =>
            countMessages(activePanel.webview.messages, 'data') >
            initialDataCount
        );
        assert.equal(shapeScanCount, 1);
      } finally {
        panel?.dispose();
        if (shapeSignals.length > 0) {
          assert.equal(shapeSignals[0]?.aborted, true);
        }
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    {
      nodeFsOverrides: {
        watch: () => {
          const watcher = {
            on: () => watcher,
            close: () => undefined
          };
          return watcher;
        }
      },
      csvOverrides: {
        scanCsvShape: (
          _filePath: string,
          options: { readonly signal?: AbortSignal }
        ) => {
          shapeScanCount += 1;
          shapeSignals.push(options.signal as AbortSignal);
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              'abort',
              () => reject(makeAbortError()),
              { once: true }
            );
          });
        }
      }
    }
  );
});

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

async function withMockedExtension(
  run: (context: {
    readonly extension: ExtensionModule;
    readonly vscode: VscodeMock;
  }) => Promise<void>,
  overrides: ExtensionTestOverrides = {}
): Promise<void> {
  const vscode = createVscodeMock();
  const extensionPath = path.join(process.cwd(), 'out', 'src', 'extension.js');
  const csvPath = path.join(process.cwd(), 'out', 'src', 'csv.js');
  const csvOverrides = overrides.csvOverrides ?? {};
  const nodeFsOverrides = overrides.nodeFsOverrides ?? {};
  const realCsv =
    Object.keys(csvOverrides).length > 0
      ? (require(csvPath) as Record<string, unknown>)
      : undefined;
  const realNodeFs =
    Object.keys(nodeFsOverrides).length > 0
      ? (require('node:fs') as Record<string, unknown>)
      : undefined;
  moduleLoader._load = function (
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (request === 'vscode') {
      return vscode;
    }

    if (request === './csv' && realCsv) {
      return {
        ...realCsv,
        ...csvOverrides
      };
    }

    if (request === 'node:fs' && realNodeFs) {
      return {
        ...realNodeFs,
        ...nodeFsOverrides
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve(extensionPath)];

  try {
    const extension = require(extensionPath) as ExtensionModule;
    await run({ extension, vscode });
  } finally {
    delete require.cache[require.resolve(extensionPath)];
    moduleLoader._load = originalLoad;
  }
}

function createVscodeMock(): VscodeMock {
  const state: VscodeMock['__state'] = {
    commands: new Map(),
    executedCommands: [],
    warnings: [],
    errors: [],
    configuration: {
      maxRows: 20,
      firstRowIsHeader: true,
      wrapCellContents: true
    },
    configurationListeners: [],
    saveListeners: []
  };

  return {
    commands: {
      registerCommand: (command, callback) => {
        state.commands.set(command, callback);
        return disposable(() => {
          state.commands.delete(command);
        });
      },
      executeCommand: async (...args) => {
        state.executedCommands.push(args);
      }
    },
    window: {
      tabGroups: {
        activeTabGroup: {}
      },
      registerCustomEditorProvider: (viewType, provider, options) => {
        state.provider = { viewType, provider, options };
        return disposable(() => {
          state.provider = undefined;
        });
      },
      showWarningMessage: async (message) => {
        state.warnings.push(message);
        return undefined;
      },
      showErrorMessage: async (message) => {
        state.errors.push(message);
        return undefined;
      }
    },
    workspace: {
      getConfiguration: (section) => {
        assert.equal(section, 'quickCsvViewer');
        return {
          get: (key) => state.configuration[key],
          update: async (key, value) => {
            if (state.configurationUpdateError !== undefined) {
              throw state.configurationUpdateError;
            }

            state.configuration[key] = value;
            for (const listener of state.configurationListeners) {
              listener({
                affectsConfiguration: (name) => name === `quickCsvViewer.${key}`
              });
            }
          }
        };
      },
      onDidChangeConfiguration: (listener) => {
        state.configurationListeners.push(listener);
        return disposable(() => {
          removeItem(state.configurationListeners, listener);
        });
      },
      onDidSaveTextDocument: (listener) => {
        state.saveListeners.push(listener);
        return disposable(() => {
          removeItem(state.saveListeners, listener);
        });
      }
    },
    Uri: FakeUri,
    TabInputText: FakeTabInputText,
    TabInputCustom: FakeTabInputCustom,
    TabInputTextDiff: FakeTabInputTextDiff,
    ViewColumn: {
      Active: 1,
      One: 1,
      Beside: 2
    },
    ConfigurationTarget: {
      Global: 'global'
    },
    __state: state
  };
}

function createFakeWebviewPanel(
  viewColumn: number | undefined
): FakeWebviewPanel {
  let messageListener: ((message: unknown) => void) | undefined;
  let disposeListener: (() => void) | undefined;
  const panel: FakeWebviewPanel = {
    viewColumn,
    reveals: [],
    webview: {
      options: {},
      html: '',
      messages: [],
      postMessage: async (message) => {
        panel.webview.messages.push(message);
        return true;
      },
      onDidReceiveMessage: (listener) => {
        messageListener = listener;
        return disposable(() => {
          messageListener = undefined;
        });
      },
      receive: (message) => {
        messageListener?.(message);
      }
    },
    reveal: (column, preserveFocus) => {
      panel.reveals.push({ column, preserveFocus });
    },
    onDidDispose: (listener) => {
      disposeListener = listener;
      return disposable(() => {
        disposeListener = undefined;
      });
    },
    dispose: () => {
      disposeListener?.();
    }
  };
  return panel;
}

function getRegisteredProvider(vscode: VscodeMock): RegisteredProvider {
  const provider = vscode.__state.provider;
  assert.ok(provider);
  return provider;
}

function hasMessageType(messages: readonly unknown[], type: string): boolean {
  return messages.some(
    (message) => isMessage(message) && message.type === type
  );
}

function countMessages(messages: readonly unknown[], type: string): number {
  return messages.filter(
    (message) => isMessage(message) && message.type === type
  ).length;
}

function isMessage(value: unknown): value is {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly message?: unknown;
  readonly value?: unknown;
  readonly shape?: { readonly rowCount?: unknown };
  readonly payload?: {
    readonly maxRows?: unknown;
    readonly shape?: unknown;
    readonly preview?: {
      readonly loadedRowCount?: unknown;
      readonly rows?: Array<{ readonly cells?: unknown[] }>;
    };
    readonly rows?: unknown;
    readonly totalRows?: unknown;
  };
} {
  return typeof value === 'object' && value !== null;
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!assertion()) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error('Timed out waiting for condition.');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function sleep(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function makeAbortError(): Error {
  return Object.assign(new Error('Operation cancelled.'), {
    name: 'AbortError'
  });
}

function disposable(dispose: () => void): Disposable {
  return { dispose };
}

function removeItem<T>(items: T[], value: T): void {
  const index = items.indexOf(value);
  if (index >= 0) {
    items.splice(index, 1);
  }
}
