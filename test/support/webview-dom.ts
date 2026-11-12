import { JSDOM, VirtualConsole } from 'jsdom';
import { getHtml } from '../../src/extension/webview';

export interface PostedMessage {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly start?: unknown;
  readonly count?: unknown;
  readonly value?: unknown;
}

export interface WebviewHarness {
  readonly window: JSDOM['window'];
  readonly document: Document;
  readonly posted: PostedMessage[];
  readonly errors: string[];
  send(message: unknown): void;
  click(id: string): void;
  byId(id: string): HTMLElement;
  close(): void;
}

// Runs the real webview HTML and inline script in jsdom with a stub
// `acquireVsCodeApi`, so tests can drive it with host messages.
export function createWebviewHarness(): WebviewHarness {
  const posted: PostedMessage[] = [];
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    errors.push(error.message);
  });
  const dom = new JSDOM(getHtml('sample.csv'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.assign(window, {
        acquireVsCodeApi: () => ({
          postMessage: (message: PostedMessage) => {
            // VS Code serializes webview messages; this also moves them out of
            // the jsdom realm so strict deep equality works in assertions.
            posted.push(JSON.parse(JSON.stringify(message)) as PostedMessage);
          }
        })
      });
    }
  });
  const { window } = dom;
  const byId = (id: string): HTMLElement => {
    const element = window.document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }

    return element;
  };

  return {
    window,
    document: window.document,
    posted,
    errors,
    send: (message) => {
      window.dispatchEvent(
        new window.MessageEvent('message', { data: message })
      );
    },
    click: (id) => {
      byId(id).click();
    },
    byId,
    close: () => {
      window.close();
    }
  };
}

export function limitedDataMessage(options: {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly firstRowIsHeader?: boolean;
  readonly columnCount?: number;
}): unknown {
  const firstRowIsHeader = options.firstRowIsHeader ?? true;
  const headerFields = firstRowIsHeader ? [...options.headers] : [];
  const columnCount = options.columnCount ?? options.headers.length;
  return {
    type: 'data',
    payload: {
      ...metadata(options.rows.length, firstRowIsHeader),
      shape: null,
      preview: {
        headers: headerFields,
        headerFields,
        rows: options.rows.map((cells, index) => ({
          rowNumber: index + 1,
          cells: [...cells]
        })),
        loadedRowCount: options.rows.length,
        displayLimit: options.rows.length,
        columnCount,
        indexedRecordCount: options.rows.length + 1,
        isComplete: true
      }
    }
  };
}

export function fullIndexMessages(
  headers: readonly string[],
  totalRows: number
): [unknown, unknown] {
  return [
    {
      type: 'fullIndexStart',
      payload: { ...metadata(0, true), totalBytes: 1024 }
    },
    {
      type: 'fullIndexReady',
      payload: {
        ...metadata(0, true),
        shape: null,
        totalRows,
        isComplete: true,
        columnCount: headers.length,
        headers: [...headers],
        headerFields: [...headers]
      }
    }
  ];
}

export function rowsReply(
  requestId: unknown,
  start: number,
  count: number,
  headers: readonly string[],
  totalRows: number
): unknown {
  const rows = [];
  for (let index = start; index < start + count; index += 1) {
    rows.push({
      rowNumber: index + 1,
      cells: headers.map((header) => `${header}-${index + 1}`)
    });
  }

  return {
    type: 'rows',
    requestId,
    payload: { start, rows, totalRows, indexedDataRowCount: totalRows }
  };
}

export function texts(elements: Iterable<Element>): string[] {
  return Array.from(elements, (element) => element.textContent ?? '');
}

export function fetchRequests(
  harness: WebviewHarness,
  prefix: string
): PostedMessage[] {
  return harness.posted.filter(
    (message) =>
      message.type === 'fetchRows' &&
      typeof message.requestId === 'string' &&
      message.requestId.startsWith(prefix)
  );
}

function metadata(maxRows: number, firstRowIsHeader: boolean) {
  return {
    fileName: 'sample.csv',
    fileSize: '1.0 KB',
    lastModified: 'today',
    maxRows,
    firstRowIsHeader,
    wrapCellContents: true
  };
}
