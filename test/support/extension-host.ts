import * as assert from 'node:assert/strict';
import Module from 'node:module';
import * as path from 'node:path';
export interface Disposable {
  dispose(): void;
}

export interface ExtensionModule {
  activate(context: {
    extensionUri?: FakeUri;
    subscriptions: Disposable[];
  }): void;
  deactivate(): void;
}

export interface RegisteredProvider {
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

export interface VscodeMock {
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
    configurationReadError?: unknown;
    configurationUpdateError?: unknown;
    executeCommandError?: unknown;
    provider?: RegisteredProvider;
  };
}

export interface FakeWebview {
  options: Record<string, unknown>;
  html: string;
  readonly messages: unknown[];
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
  receive(message: unknown): void;
}

export interface FakeWebviewPanel {
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

export class FakeUri {
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

export class FakeTabInputText {
  public constructor(public readonly uri: FakeUri) {}
}

export class FakeTabInputCustom {
  public constructor(public readonly uri: FakeUri) {}
}

export class FakeTabInputTextDiff {
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

export interface ExtensionTestOverrides {
  readonly csvOverrides?: Record<string, unknown>;
  readonly nodeFsOverrides?: Record<string, unknown>;
}

export async function withMockedExtension(
  run: (context: {
    readonly extension: ExtensionModule;
    readonly vscode: VscodeMock;
  }) => Promise<void>,
  overrides: ExtensionTestOverrides = {}
): Promise<void> {
  const vscode = createVscodeMock();
  const extensionPath = path.join(process.cwd(), 'out', 'src', 'extension.js');
  const extensionModuleRoot = path.join(
    process.cwd(),
    'out',
    'src',
    'extension'
  );
  const csvPath = path.join(process.cwd(), 'out', 'src', 'csv.js');
  const csvOverrides = overrides.csvOverrides ?? {};
  const nodeFsOverrides = overrides.nodeFsOverrides ?? {};
  const clearExtensionModuleCache = (): void => {
    for (const cachePath of Object.keys(require.cache)) {
      if (
        cachePath === extensionPath ||
        cachePath.startsWith(extensionModuleRoot + path.sep)
      ) {
        delete require.cache[cachePath];
      }
    }
  };
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

    if (
      ['./csv', '../csv', '../../csv', '../../../csv'].includes(request) &&
      realCsv
    ) {
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
  clearExtensionModuleCache();

  try {
    const extension = require(extensionPath) as ExtensionModule;
    await run({ extension, vscode });
  } finally {
    clearExtensionModuleCache();
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
        if (state.executeCommandError !== undefined) {
          throw state.executeCommandError;
        }
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
        if (state.configurationReadError !== undefined) {
          throw state.configurationReadError;
        }

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

export function createFakeWebviewPanel(
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

export function getRegisteredProvider(vscode: VscodeMock): RegisteredProvider {
  const provider = vscode.__state.provider;
  assert.ok(provider);
  return provider;
}

export function hasMessageType(
  messages: readonly unknown[],
  type: string
): boolean {
  return messages.some(
    (message) => isMessage(message) && message.type === type
  );
}

export function countMessages(
  messages: readonly unknown[],
  type: string
): number {
  return messages.filter(
    (message) => isMessage(message) && message.type === type
  ).length;
}

export function isMessage(value: unknown): value is {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly message?: unknown;
  readonly value?: unknown;
  readonly shape?: { readonly rowCount?: unknown };
  readonly payload?: {
    readonly maxRows?: unknown;
    readonly firstRowIsHeader?: unknown;
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

export async function waitFor(assertion: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!assertion()) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error('Timed out waiting for condition.');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function sleep(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export function makeAbortError(): Error {
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
