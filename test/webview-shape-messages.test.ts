import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWebviewHarness,
  fetchRequests,
  type WebviewHarness
} from './support/webview-dom';

const HEADERS = ['id', 'name', 'city'];

// An exact-shape scan survives settings-only reloads, so its messages can
// arrive while a later load is still building its row index.
function indexStart(maxRows: number): unknown {
  return {
    type: 'fullIndexStart',
    payload: { ...metadata(maxRows), totalBytes: 4096 }
  };
}

function indexReady(
  maxRows: number,
  totalRows: number,
  shape: unknown = null
): unknown {
  return {
    type: 'fullIndexReady',
    payload: {
      ...metadata(maxRows),
      shape,
      totalRows,
      isComplete: false,
      columnCount: HEADERS.length,
      headers: HEADERS,
      headerFields: HEADERS
    }
  };
}

function indexProgress(percent: number): unknown {
  return {
    type: 'fullIndexProgress',
    payload: {
      bytesRead: 1024,
      totalBytes: 4096,
      percent,
      indexedRecordCount: 100,
      columnCount: HEADERS.length
    }
  };
}

function shapeMessage(rowCount: number): unknown {
  return {
    type: 'shape',
    shape: {
      rowCount,
      columnCount: HEADERS.length,
      recordCount: rowCount + 1
    }
  };
}

function metadata(maxRows: number) {
  return {
    fileName: 'sample.csv',
    fileSize: '4.0 KB',
    lastModified: 'today',
    maxRows,
    firstRowIsHeader: true,
    wrapCellContents: true
  };
}

function withHarness(run: (harness: WebviewHarness) => void): void {
  const harness = createWebviewHarness();
  try {
    run(harness);
    assert.deepEqual(harness.errors, []);
  } finally {
    harness.close();
  }
}

function text(harness: WebviewHarness, id: string): string | null {
  return harness.byId(id).textContent;
}

function isIndexingPanelShown(harness: WebviewHarness): boolean {
  return Boolean(
    harness.document.querySelector('#content .progress-panel button')
  );
}

test('a shape that arrives during indexing keeps the progress panel and requests no rows', () => {
  withHarness((harness) => {
    harness.send(indexStart(0));
    harness.send(indexProgress(40));
    assert.equal(isIndexingPanelShown(harness), true);

    harness.send(shapeMessage(1000));

    assert.equal(isIndexingPanelShown(harness), true);
    assert.equal(text(harness, 'csv-shape'), 'Indexing...');
    assert.equal(text(harness, 'preview-status'), 'Indexing full file 40.0%');
    assert.equal(
      (harness.byId('rows-input') as HTMLInputElement).disabled,
      true
    );
    assert.deepEqual(fetchRequests(harness, 'rows-'), []);

    harness.send(indexReady(0, 1000));
    const [request] = fetchRequests(harness, 'rows-');
    assert.equal(typeof request?.count, 'number');
    assert.equal(isIndexingPanelShown(harness), false);
  });
});

test('fullIndexReady keeps a shape that arrived during indexing when its payload has none', () => {
  withHarness((harness) => {
    harness.send(indexStart(0));
    harness.send(shapeMessage(1000));
    harness.send(indexReady(0, 1000));

    assert.equal(text(harness, 'csv-shape'), '1,000 rows x 3 columns');
  });
});

test('fullIndexReady prefers its own shape over one received during indexing', () => {
  withHarness((harness) => {
    harness.send(indexStart(0));
    harness.send(shapeMessage(1000));
    harness.send(
      indexReady(0, 2000, { rowCount: 2000, columnCount: 3, recordCount: 2001 })
    );

    assert.equal(text(harness, 'csv-shape'), '2,000 rows x 3 columns');
  });
});

test('shape progress and errors during indexing leave the indexing status alone', () => {
  withHarness((harness) => {
    harness.send(indexStart(500));
    harness.send(indexProgress(40));
    const status = 'Preparing indexed preview 40.0%';
    assert.equal(text(harness, 'preview-status'), status);

    harness.send({ type: 'shapeProgress', payload: { percent: 50 } });
    assert.equal(text(harness, 'preview-status'), status);
    assert.equal(text(harness, 'csv-shape'), 'Indexing...');

    harness.send({ type: 'shapeError', message: 'scan failed' });
    assert.equal(text(harness, 'preview-status'), status);
    assert.equal(text(harness, 'csv-shape'), 'Indexing...');
    assert.equal(isIndexingPanelShown(harness), true);

    harness.send(indexReady(500, 500));
    assert.equal(text(harness, 'preview-status'), 'Showing first 500 rows');
    assert.equal(text(harness, 'csv-shape'), 'Counting...');
  });
});

test('shape messages after the index is ready still update the viewer', () => {
  withHarness((harness) => {
    harness.send(indexStart(0));
    harness.send(indexReady(0, 1000));
    assert.equal(text(harness, 'csv-shape'), 'Counting...');

    harness.send({ type: 'shapeProgress', payload: { percent: 50 } });
    assert.equal(text(harness, 'csv-shape'), 'Counting 50.0%');

    harness.send(shapeMessage(1000));
    assert.equal(text(harness, 'csv-shape'), '1,000 rows x 3 columns');

    harness.send({ type: 'shapeError', message: 'scan failed' });
    assert.equal(text(harness, 'csv-shape'), 'Unavailable');
  });
});

test('fullIndexReady outside indexing does not reuse an older shape', () => {
  withHarness((harness) => {
    harness.send(indexStart(0));
    harness.send(shapeMessage(1000));
    harness.send(indexReady(0, 1000));
    assert.equal(text(harness, 'csv-shape'), '1,000 rows x 3 columns');

    // Only shapes received while this load was indexing may carry over.
    harness.send(indexReady(0, 1000));
    assert.equal(text(harness, 'csv-shape'), 'Counting...');
  });
});

test('fullIndexReady keeps shape-scan progress received during indexing', () => {
  withHarness((harness) => {
    harness.send(indexStart(0));
    harness.send({ type: 'shapeProgress', payload: { percent: 77 } });
    harness.send(indexReady(0, 1000));

    assert.equal(text(harness, 'csv-shape'), 'Counting 77.0%');
  });
});

test('shape messages during preview loading leave the info bar alone', () => {
  withHarness((harness) => {
    harness.send({
      type: 'previewLoadStart',
      payload: { ...metadata(150), displayLimit: 150 }
    });
    harness.send({
      type: 'previewLoadProgress',
      payload: { loadedRowCount: 40, displayLimit: 150, percent: 26 }
    });
    assert.equal(text(harness, 'csv-shape'), 'Counting...');

    harness.send(shapeMessage(1000));
    assert.equal(text(harness, 'csv-shape'), 'Counting...');
    harness.send({ type: 'shapeProgress', payload: { percent: 50 } });
    assert.equal(text(harness, 'csv-shape'), 'Counting...');
    harness.send({ type: 'shapeError', message: 'scan failed' });
    assert.equal(text(harness, 'csv-shape'), 'Counting...');
  });
});

test('a shape re-sent after a cancelled index updates the restored view', () => {
  withHarness((harness) => {
    harness.send({
      type: 'data',
      payload: {
        ...metadata(20),
        shape: null,
        preview: {
          headers: HEADERS,
          headerFields: HEADERS,
          rows: [{ rowNumber: 1, cells: ['1', 'Ada', 'Paris'] }],
          loadedRowCount: 1,
          displayLimit: 20,
          columnCount: HEADERS.length,
          indexedRecordCount: 2,
          isComplete: false
        }
      }
    });
    harness.send({ type: 'loading' });
    harness.send(indexStart(0));
    harness.send(shapeMessage(1000));
    harness.send({ type: 'restorePreviousView' });
    assert.equal(text(harness, 'csv-shape'), 'Counting...');

    // The host re-sends its cached shape right after restorePreviousView.
    harness.send(shapeMessage(1000));
    assert.equal(text(harness, 'csv-shape'), '1,000 rows x 3 columns');
    assert.equal(text(harness, 'preview-status'), 'Showing 1 loaded rows');
  });
});
