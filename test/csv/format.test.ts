import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFileSize } from '../../src/csv';

test('file sizes are formatted across byte units and invalid inputs', () => {
  assert.equal(formatFileSize(-1), '0 B');
  assert.equal(formatFileSize(Number.NaN), '0 B');
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(1023), '1023 B');
  assert.equal(formatFileSize(1024), '1.00 KB');
  assert.equal(formatFileSize(10 * 1024), '10.0 KB');
  assert.equal(formatFileSize(1024 ** 2), '1.00 MB');
  assert.equal(formatFileSize(1024 ** 4), '1.00 TB');
  assert.equal(formatFileSize(1024 ** 5), '1024.0 TB');
});
