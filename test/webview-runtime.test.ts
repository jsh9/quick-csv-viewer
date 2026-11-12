import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWebviewHarness,
  fetchRequests,
  fullIndexMessages,
  limitedDataMessage,
  rowsReply,
  texts,
  transposedBody,
  transposedHeader,
  type WebviewHarness
} from './support/webview-dom';

const HEADERS = ['id', 'name', 'city'];
const ROWS = [
  ['1', 'Ada', 'Paris'],
  ['2', 'Bob', 'Lima'],
  ['3', 'Cy', 'Oslo']
];

function withHarness(run: (harness: WebviewHarness) => void): void {
  const harness = createWebviewHarness();
  try {
    run(harness);
    assert.deepEqual(harness.errors, []);
  } finally {
    harness.close();
  }
}

function isDisabled(harness: WebviewHarness, id: string): boolean {
  return (harness.byId(id) as HTMLButtonElement).disabled;
}

test('webview runtime keeps new controls disabled until a ready render', () => {
  withHarness((harness) => {
    assert.deepEqual(harness.posted, [{ type: 'ready' }]);
    assert.equal(isDisabled(harness, 'copy-column-names'), true);
    assert.equal(isDisabled(harness, 'transposed-view'), true);

    harness.send(limitedDataMessage({ headers: HEADERS, rows: ROWS }));
    assert.equal(isDisabled(harness, 'copy-column-names'), false);
    assert.equal(isDisabled(harness, 'transposed-view'), false);

    harness.send({ type: 'loading' });
    assert.equal(isDisabled(harness, 'copy-column-names'), true);
    assert.equal(isDisabled(harness, 'transposed-view'), true);
  });
});

test('webview runtime transposes CSV columns into rows and back', () => {
  withHarness((harness) => {
    harness.send(limitedDataMessage({ headers: HEADERS, rows: ROWS }));
    harness.click('transposed-view');

    assert.equal(
      harness.byId('transposed-view').getAttribute('aria-pressed'),
      'true'
    );
    assert.equal(
      harness.byId('quick-view').getAttribute('aria-pressed'),
      'false'
    );
    assert.deepEqual(transposedHeader(harness), ['0', '1', '2', '3']);
    assert.deepEqual(transposedBody(harness), [
      ['id', '1', '2', '3'],
      ['name', 'Ada', 'Bob', 'Cy'],
      ['city', 'Paris', 'Lima', 'Oslo']
    ]);
    const fieldCell = harness.document.querySelector(
      '.transposed-scroll .table-body .field-cell'
    );
    assert.equal(fieldCell?.getAttribute('role'), 'rowheader');
    assert.equal(
      harness.byId('preview-status').textContent,
      'Showing first 3 rows'
    );

    harness.click('wrap-toggle');
    assert.deepEqual(harness.posted.at(-1), {
      type: 'updateWrapCellContents',
      value: false
    });
    const scroll = harness.document.querySelector('.table-scroll');
    assert.equal(scroll?.className, 'table-scroll transposed-scroll');

    harness.click('quick-view');
    assert.equal(harness.document.querySelector('.transposed-scroll'), null);
    assert.deepEqual(
      texts(harness.document.querySelectorAll('.table-header .table-cell')),
      ['0', 'id', 'name', 'city']
    );
    assert.deepEqual(
      Array.from(
        harness.document.querySelectorAll('.table-body .table-row'),
        (row) => texts(row.children)
      ),
      [
        ['1', ...ROWS[0]],
        ['2', ...ROWS[1]],
        ['3', ...ROWS[2]]
      ]
    );
  });
});

test('webview runtime labels generated columns when the header row is off', () => {
  withHarness((harness) => {
    harness.send(
      limitedDataMessage({
        headers: HEADERS,
        rows: ROWS,
        firstRowIsHeader: false
      })
    );
    harness.click('transposed-view');

    assert.deepEqual(transposedHeader(harness), ['', '1', '2', '3']);
    assert.deepEqual(
      transposedBody(harness).map((row) => row[0]),
      ['Column 1', 'Column 2', 'Column 3']
    );

    harness.click('copy-column-names');
    assert.deepEqual(harness.posted.at(-1), {
      type: 'copyColumnNames',
      value: ['Column 1', 'Column 2', 'Column 3']
    });
  });
});

test('webview runtime caps transposed cells for wide files and says so', () => {
  withHarness((harness) => {
    harness.send(limitedDataMessage({ headers: HEADERS, rows: ROWS }));
    harness.click('transposed-view');

    const headers = Array.from({ length: 2500 }, (_, index) => `c${index}`);
    const rows = Array.from({ length: 30 }, (_, rowIndex) =>
      headers.map((header) => `${header}-${rowIndex}`)
    );
    harness.send(limitedDataMessage({ headers, rows }));

    // 20,000 cells / 2,500 columns leaves room for 8 transposed rows.
    assert.equal(transposedHeader(harness).length, 9);
    assert.equal(transposedBody(harness).length, 2500);
    assert.equal(
      harness.byId('preview-status').textContent,
      'Showing first 30 rows; transposed view shows first 8'
    );
  });
});

test('webview runtime fetches indexed transposed rows once and ignores stale replies', () => {
  withHarness((harness) => {
    const [start, ready] = fullIndexMessages(HEADERS, 5000);
    harness.send(start);
    harness.send(ready);
    const tableRequest = fetchRequests(harness, 'rows-').at(-1);
    assert.ok(tableRequest);

    harness.click('transposed-view');
    const transposedRequests = fetchRequests(harness, 'transposed-');
    assert.equal(transposedRequests.length, 1);
    assert.equal(transposedRequests[0].start, 0);
    assert.equal(transposedRequests[0].count, 100);
    assert.equal(
      harness.document.querySelector('#content .status')?.textContent,
      'Loading rows for transposed view...'
    );

    // A late reply for the table viewport must not render anything.
    harness.send(rowsReply(tableRequest.requestId, 0, 20, HEADERS, 5000));
    assert.equal(harness.document.querySelector('.transposed-scroll'), null);

    // A shape update while the fetch is in flight must not fetch again.
    harness.send({
      type: 'shape',
      shape: { rowCount: 5000, columnCount: 3, recordCount: 5001 }
    });
    assert.equal(fetchRequests(harness, 'transposed-').length, 1);

    harness.send(
      rowsReply(transposedRequests[0].requestId, 0, 100, HEADERS, 5000)
    );
    assert.equal(transposedHeader(harness).length, 101);
    assert.deepEqual(transposedBody(harness)[1].slice(0, 3), [
      'name',
      'name-1',
      'name-2'
    ]);
    assert.equal(
      harness.byId('preview-status').textContent,
      'Virtual full-file view; transposed view shows first 100'
    );

    harness.click('quick-view');
    harness.click('transposed-view');
    assert.equal(fetchRequests(harness, 'transposed-').length, 1);
    assert.equal(transposedHeader(harness).length, 101);

    // A new load produces a new payload, so the cache no longer applies.
    harness.send(start);
    harness.send(ready);
    assert.equal(fetchRequests(harness, 'transposed-').length, 2);
  });
});

test('webview runtime re-requests transposed rows after a cancelled load', () => {
  withHarness((harness) => {
    const [start, ready] = fullIndexMessages(HEADERS, 50);
    harness.send(start);
    harness.send(ready);
    harness.click('transposed-view');
    const [dropped] = fetchRequests(harness, 'transposed-');

    // The host drops replies from older load generations, so a restore must
    // ask again instead of waiting on the dropped request.
    harness.send({ type: 'loading' });
    harness.send({ type: 'restorePreviousView' });
    const requests = fetchRequests(harness, 'transposed-');
    assert.equal(requests.length, 2);

    harness.send(rowsReply(dropped.requestId, 0, 50, HEADERS, 50));
    assert.equal(harness.document.querySelector('.transposed-scroll'), null);

    harness.send(rowsReply(requests[1].requestId, 0, 50, HEADERS, 50));
    assert.equal(transposedHeader(harness).length, 51);
  });
});

test('webview runtime caches a transposed reply that arrives after switching back', () => {
  withHarness((harness) => {
    const [start, ready] = fullIndexMessages(HEADERS, 10);
    harness.send(start);
    harness.send(ready);
    harness.click('transposed-view');
    const [request] = fetchRequests(harness, 'transposed-');
    harness.click('quick-view');

    harness.send(rowsReply(request.requestId, 0, 10, HEADERS, 10));
    assert.equal(harness.document.querySelector('.transposed-scroll'), null);

    harness.click('transposed-view');
    assert.equal(fetchRequests(harness, 'transposed-').length, 1);
    assert.deepEqual(transposedHeader(harness), [
      '0',
      ...Array.from({ length: 10 }, (_, index) => String(index + 1))
    ]);
  });
});

test('webview runtime keeps each view scroll position and the virtual table', () => {
  withHarness((harness) => {
    const rows = Array.from({ length: 300 }, (_, index) => [
      String(index + 1),
      `name-${index}`,
      'Lima'
    ]);
    harness.send(limitedDataMessage({ headers: HEADERS, rows }));
    assert.ok(harness.document.querySelector('.virtual-rows'));

    const tableScroll = harness.document.querySelector('.table-scroll');
    assert.ok(tableScroll);
    tableScroll.scrollTop = 1234;
    tableScroll.scrollLeft = 56;

    harness.click('transposed-view');
    const transposedScroll =
      harness.document.querySelector('.transposed-scroll');
    assert.ok(transposedScroll);
    assert.equal(transposedScroll.scrollTop, 0);
    transposedScroll.scrollLeft = 78;

    harness.click('quick-view');
    const restoredTable = harness.document.querySelector('.table-scroll');
    assert.ok(restoredTable);
    assert.ok(harness.document.querySelector('.virtual-rows'));
    assert.equal(restoredTable.scrollTop, 1234);
    assert.equal(restoredTable.scrollLeft, 56);

    harness.click('transposed-view');
    assert.equal(
      harness.document.querySelector('.transposed-scroll')?.scrollLeft,
      78
    );
  });
});

test('webview runtime posts displayed column names and announces copy results', () => {
  withHarness((harness) => {
    harness.send(limitedDataMessage({ headers: HEADERS, rows: ROWS }));
    harness.click('copy-column-names');
    assert.deepEqual(harness.posted.at(-1), {
      type: 'copyColumnNames',
      value: HEADERS
    });

    const button = harness.byId('copy-column-names');
    const status = harness.byId('copy-status');
    harness.send({ type: 'columnNamesCopied', count: 3 });
    assert.equal(button.textContent, 'Copied!');
    assert.equal(status.textContent, 'Copied 3 column names to the clipboard.');

    harness.send({ type: 'columnNamesCopied', count: 1 });
    assert.equal(status.textContent, 'Copied 1 column name to the clipboard.');

    harness.send({
      type: 'copyColumnNamesError',
      message: 'Clipboard unavailable.'
    });
    assert.equal(button.textContent, 'Copy failed');
    assert.equal(status.textContent, 'Clipboard unavailable.');

    // Info bar re-renders must not wipe the announcement.
    harness.send({ type: 'shapeProgress', payload: { percent: 50 } });
    assert.equal(status.textContent, 'Clipboard unavailable.');
    assert.equal(
      harness.byId('preview-status').textContent,
      'Showing first 3 rows'
    );
  });
});

test('webview runtime disables copy when the file has no columns', () => {
  withHarness((harness) => {
    harness.send(limitedDataMessage({ headers: [], rows: [], columnCount: 0 }));
    assert.equal(isDisabled(harness, 'copy-column-names'), true);
    assert.equal(isDisabled(harness, 'transposed-view'), false);

    harness.click('transposed-view');
    assert.equal(
      harness.document.querySelector('#content .status')?.textContent,
      'No rows loaded from this CSV file.'
    );
  });
});
