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

test('publish workflow runs only for version tags and can request OIDC tokens and create releases', async () => {
  const workflow = await readWorkflow();

  assert.match(
    workflow,
    /on:\n {2}push:\n {4}tags:\n {6}- '\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\n/
  );
  assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|branches:/);
  // Read-only by default; only the publish job may write the release.
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.match(
    workflow,
    /permissions:\n(?: {6}#[^\n]*\n)? {6}contents: write\n {6}id-token: write\n/
  );
  assert.match(workflow, /node-version: 22\n/);
});

test('publish workflow checks the tag and notes, tests, and packages once before publishing', async () => {
  const workflow = await readWorkflow();
  assert.match(
    workflow,
    /VSIX: quick-csv-viewer-\$\{\{ github\.ref_name \}\}\.vsix\n/
  );
  const order = [
    'if [ "$GITHUB_REF_NAME" != "$version" ]; then',
    'node scripts/release-notes.cjs "$GITHUB_REF_NAME" > "$RUNNER_TEMP/release-notes.md"',
    'run: npm ci',
    'run: npm test',
    'npx --yes @vscode/vsce@4.1.0 package --out "$VSIX"',
    'npx --yes @vscode/vsce@4.1.0 publish --oidc --skip-duplicate --packagePath "$VSIX"',
    'npx --yes ovsx@1.3.0 publish "$VSIX" --trusted-publishing --skip-duplicate',
    'gh release create "$GITHUB_REF_NAME" "$VSIX"'
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

test('publish workflow creates the GitHub release once both registries accept the version', async () => {
  const workflow = await readWorkflow();
  const releaseStep = workflow.slice(
    workflow.indexOf('- name: Create the GitHub release')
  );

  assert.match(releaseStep, /GH_TOKEN: \$\{\{ github\.token \}\}\n/);
  // An existing release (a re-run, or one drafted by hand) keeps its notes and
  // only gets the package attached.
  assert.match(
    releaseStep,
    /if gh release view "\$GITHUB_REF_NAME" > \/dev\/null 2>&1; then\n\s*gh release upload "\$GITHUB_REF_NAME" "\$VSIX" --clobber\n\s*else\n\s*gh release create "\$GITHUB_REF_NAME" "\$VSIX" \\\n\s*--title "\$GITHUB_REF_NAME" \\\n\s*--notes-file "\$RUNNER_TEMP\/release-notes\.md" \\\n\s*--verify-tag\n\s*fi\n/
  );
});
