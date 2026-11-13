import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

async function readWorkflow(): Promise<string> {
  return fs.readFile(
    path.join(process.cwd(), '.github', 'workflows', 'publish.yml'),
    'utf8'
  );
}

test('publish workflow runs only for version tags and can request OIDC tokens', async () => {
  const workflow = await readWorkflow();

  assert.match(
    workflow,
    /on:\n {2}push:\n {4}tags:\n {6}- '\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\n/
  );
  assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|branches:/);
  assert.match(
    workflow,
    /permissions:\n {6}contents: read\n {6}id-token: write\n/
  );
  assert.match(workflow, /node-version: 22\n/);
});

test('publish workflow checks the tag, tests, and packages once before publishing', async () => {
  const workflow = await readWorkflow();
  const order = [
    'if [ "$GITHUB_REF_NAME" != "$version" ]; then',
    'run: npm ci',
    'run: npm test',
    'npx --yes @vscode/vsce@4.1.0 package --out quick-csv-viewer.vsix',
    'npx --yes @vscode/vsce@4.1.0 publish --oidc --skip-duplicate --packagePath quick-csv-viewer.vsix',
    'npx --yes ovsx@1.3.0 publish quick-csv-viewer.vsix --trusted-publishing --skip-duplicate'
  ].map((step) => {
    const index = workflow.indexOf(step);
    assert.notEqual(index, -1, `missing step: ${step}`);
    return index;
  });

  assert.deepEqual(
    order,
    [...order].sort((left, right) => left - right)
  );
});

test('publish workflow uses trusted publishing instead of stored tokens', async () => {
  const workflow = await readWorkflow();

  // A stored token would take precedence over OIDC (ovsx) or need rotating
  // (vsce), so the workflow must not reference any secret.
  assert.doesNotMatch(workflow, /secrets\.|VSCE_PAT|OVSX_PAT|--pat\b/);
  assert.doesNotMatch(workflow, /(vsce|ovsx)\S*\s[^\n]*\s-p\s/);
});
