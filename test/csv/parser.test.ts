import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeHeaders, parseCsvRecordsFromText } from '../../src/csv';

test('CSV parsing handles quoted commas, escaped quotes, and embedded newlines', () => {
  assert.deepEqual(
    parseCsvRecordsFromText(
      'name,note\n"A, B","He said ""hi""\nagain"\r\nplain,last'
    ),
    [
      ['name', 'note'],
      ['A, B', 'He said "hi"\nagain'],
      ['plain', 'last']
    ]
  );
});

test('CSV parsing handles CRLF, LF, CR, blank records, and trailing newlines', () => {
  assert.deepEqual(parseCsvRecordsFromText('a,b\r\n1,2\n3,4\r5,6\n'), [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
    ['5', '6']
  ]);
  assert.deepEqual(parseCsvRecordsFromText('\n'), [['']]);
  assert.deepEqual(parseCsvRecordsFromText(''), []);
});

test('CSV parsing handles final carriage returns and unterminated quoted fields', () => {
  assert.deepEqual(parseCsvRecordsFromText('a,b\r'), [['a', 'b']]);
  assert.deepEqual(parseCsvRecordsFromText('"unterminated\nfield'), [
    ['unterminated\nfield']
  ]);
  assert.deepEqual(parseCsvRecordsFromText('"quoted"x,next'), [
    ['quotedx', 'next']
  ]);
});

test('normalizes generated column names for missing or blank headers', () => {
  assert.deepEqual(normalizeHeaders(['id', '', 'value'], 5), [
    'id',
    'Column 2',
    'value',
    'Column 4',
    'Column 5'
  ]);
});
