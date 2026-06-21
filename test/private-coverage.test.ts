import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeUri, createFakeWebviewPanel } from './support/extension-host';
import { writeFixture } from './support/csv-fixtures';
import {
  loadPrivateModule,
  replaceOnce,
  requireCompiledModule
} from './support/private-module';

interface CsvFileScanResult {
  readonly fileSize: number;
  readonly recordCount: number;
  readonly maxColumnCount: number;
  readonly scannedEndOffset: number;
  readonly isComplete: boolean;
}

interface ScanPrivateModule {
  readonly __private: {
    scanCsvFileInternal(
      filePath: string,
      options?: {
        readonly onProgress?: (result: CsvFileScanResult) => void;
        readonly recordLimit?: number;
      }
    ): Promise<CsvFileScanResult>;
  };
}

interface PreviewPrivateModule {
  readCsvPreview(
    filePath: string,
    settings: { readonly maxRows: number; readonly firstRowIsHeader: boolean },
    options: {
      readonly progressIntervalMs: number;
      readonly onProgress: (progress: {
        readonly loadedRowCount: number;
      }) => void;
    }
  ): Promise<{ readonly loadedRowCount: number }>;
}

interface LoaderPrivateModule {
  readonly __private: {
    shouldStartExactShape(value?: { readonly isComplete: boolean }): boolean;
  };
}

interface ProviderPrivateModule {
  readonly CsvViewerProvider: new () => {
    openCustomDocument(uri: FakeUri): Promise<{
      readonly uri: FakeUri;
      dispose(): void;
    }>;
    resolveCustomEditor(
      document: { readonly uri: FakeUri; dispose(): void },
      panel: ReturnType<typeof createFakeWebviewPanel>,
      token: unknown
    ): Promise<void>;
  };
}

const scanPrivateFooter = 'exports.__private = { scanCsvFileInternal };';
const isCoverageRun = Boolean(process.env.NODE_V8_COVERAGE);

function loadScanPrivate(
  options: {
    readonly requireOverrides?: Record<string, unknown>;
    readonly transform?: (source: string) => string;
  } = {}
): ScanPrivateModule {
  if (isCoverageRun) {
    return requireCompiledModule<ScanPrivateModule>(
      'csv/scan.js',
      options.requireOverrides
    );
  }

  return loadPrivateModule<ScanPrivateModule>('csv/scan.js', {
    footer: scanPrivateFooter,
    ...options
  });
}

function loadPreviewPrivate(
  transform: (source: string) => string
): PreviewPrivateModule {
  if (isCoverageRun) {
    return requireCompiledModule<PreviewPrivateModule>('csv/preview.js');
  }

  return loadPrivateModule<PreviewPrivateModule>('csv/preview.js', {
    transform
  });
}

function loadLoaderPrivate(): LoaderPrivateModule {
  if (isCoverageRun) {
    return requireCompiledModule<LoaderPrivateModule>('extension/loader.js');
  }

  return loadPrivateModule<LoaderPrivateModule>('extension/loader.js', {
    footer: 'exports.__private = { shouldStartExactShape };'
  });
}

function loadProviderPrivate(
  requireOverrides: Record<string, unknown>,
  transform: (source: string) => string
): ProviderPrivateModule {
  if (isCoverageRun) {
    return requireCompiledModule<ProviderPrivateModule>(
      'extension/provider.js',
      requireOverrides
    );
  }

  return loadPrivateModule<ProviderPrivateModule>('extension/provider.js', {
    requireOverrides,
    transform
  });
}

test('private coverage: scan internals allow omitted progress callbacks', async () => {
  const filePath = await writeFixture('private-scan-no-progress.csv', 'a\nb');
  const scan = loadScanPrivate();

  const result = await scan.__private.scanCsvFileInternal(filePath);

  assert.equal(result.recordCount, 2);
  assert.equal(result.maxColumnCount, 1);
  assert.equal(result.isComplete, true);
});

test('private coverage: scan internals normalize non-buffer stream chunks', async () => {
  const contents = 'a,b\n1,2';
  const filePath = await writeFixture('private-scan-non-buffer.csv', contents);
  let destroyed = false;
  const stream = {
    destroy: () => {
      destroyed = true;
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      yield new Uint8Array(Buffer.from(contents));
    }
  };
  const scan = loadScanPrivate({
    requireOverrides: {
      'node:fs': {
        createReadStream: () => stream
      }
    }
  });

  const result = await scan.__private.scanCsvFileInternal(filePath, {
    onProgress: () => {}
  });

  assert.equal(result.recordCount, 2);
  assert.equal(result.scannedEndOffset, Buffer.byteLength(contents));
  assert.equal(destroyed, true);
});

test('private coverage: scan internals ignore bytes after stopping', async () => {
  const filePath = await writeFixture('private-scan-stopped.csv', 'a\nb');
  const globalWithPrivate = globalThis as typeof globalThis & {
    __quickCsvCoverUndefinedByte?: boolean;
  };
  globalWithPrivate.__quickCsvCoverUndefinedByte = true;
  const scan = loadScanPrivate({
    transform: (source) => {
      const withUndefinedByteProbe = replaceOnce(
        source,
        '                processByte(buffer[index] ?? 0, chunkStartOffset + index);',
        '                globalThis.__quickCsvCoverUndefinedByte && (buffer[buffer.length] ?? 0); processByte(buffer[index] ?? 0, chunkStartOffset + index);'
      );

      return replaceOnce(
        withUndefinedByteProbe,
        '                    bytesRead = scannedEndOffset;',
        '                    processByte(0, chunkStartOffset + index); processByte(buffer[buffer.length] ?? 0, chunkStartOffset + buffer.length); bytesRead = scannedEndOffset;'
      );
    }
  });

  try {
    const result = await scan.__private.scanCsvFileInternal(filePath, {
      recordLimit: 1,
      onProgress: () => {}
    });

    assert.equal(result.recordCount, 1);
    assert.equal(result.isComplete, false);
  } finally {
    delete globalWithPrivate.__quickCsvCoverUndefinedByte;
  }
});

test('private coverage: preview throttles non-forced progress events', async () => {
  const filePath = await writeFixture('private-preview-progress.csv', 'a\n1');
  const progress: number[] = [];
  const preview = loadPreviewPrivate((source) =>
    replaceOnce(
      source,
      '    emitProgress(0, true);',
      '    emitProgress(0, true); emitProgress(0, false);'
    )
  );

  const result = await preview.readCsvPreview(
    filePath,
    { maxRows: 1, firstRowIsHeader: true },
    {
      progressIntervalMs: 60_000,
      onProgress: (event) => progress.push(event.loadedRowCount)
    }
  );

  assert.equal(result.loadedRowCount, 1);
  assert.deepEqual(progress, [0, 1]);
});

test('private coverage: loader exact-shape helper handles absent values', () => {
  const loader = loadLoaderPrivate();

  assert.equal(loader.__private.shouldStartExactShape(), true);
  assert.equal(
    loader.__private.shouldStartExactShape({ isComplete: false }),
    true
  );
  assert.equal(
    loader.__private.shouldStartExactShape({ isComplete: true }),
    false
  );
});

test('private coverage: provider column count falls back before an index exists', async () => {
  const counts: number[] = [];
  const globalWithPrivate = globalThis as typeof globalThis & {
    __quickCsvPrivateColumnCounts?: number[];
  };
  globalWithPrivate.__quickCsvPrivateColumnCounts = counts;

  try {
    const requireOverrides = {
      vscode: {
        ConfigurationTarget: { Global: 'global' },
        ViewColumn: { Active: 1 },
        commands: {
          executeCommand: async () => {}
        },
        workspace: {
          getConfiguration: () => ({
            get: (key: string) =>
              ({
                maxRows: 20,
                firstRowIsHeader: true,
                wrapCellContents: true
              })[key],
            update: async () => {}
          }),
          onDidChangeConfiguration: () => ({ dispose: () => {} }),
          onDidSaveTextDocument: () => ({ dispose: () => {} })
        }
      },
      'node:fs': {
        watch: () => {
          throw new Error('watch disabled for private coverage test');
        }
      }
    };
    const providerModule = loadProviderPrivate(requireOverrides, (source) =>
      replaceOnce(
        source,
        '        const handleFetchRows = async (message) => {',
        '        globalThis.__quickCsvPrivateColumnCounts?.push(getCurrentColumnCount()); const handleFetchRows = async (message) => {'
      )
    );
    const provider = new providerModule.CsvViewerProvider();
    const document = await provider.openCustomDocument(
      new FakeUri('/tmp/private-provider.csv')
    );
    const panel = createFakeWebviewPanel(1);

    await provider.resolveCustomEditor(document, panel, {});
    panel.dispose();

    assert.deepEqual(counts, [0]);
  } finally {
    delete globalWithPrivate.__quickCsvPrivateColumnCounts;
  }
});
