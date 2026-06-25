import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

test('package main points to the compiled extension entrypoint', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const iconPath = path.join(process.cwd(), 'images', 'icon.png');
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, 'utf8')
  ) as {
    readonly icon?: unknown;
    readonly main?: unknown;
  };

  assert.equal(packageJson.icon, 'images/icon.png');
  const icon = await fs.readFile(iconPath);
  assert.deepEqual(
    [...icon.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  );
  assert.equal(icon[25], 6);

  const main = packageJson.main;
  assert.equal(typeof main, 'string');

  if (typeof main !== 'string') {
    throw new TypeError('package.json main must be a string');
  }

  await fs.access(path.join(process.cwd(), main));
});

test('package contributes CSV viewer as the default editor association', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, 'utf8')
  ) as {
    readonly engines?: { readonly vscode?: unknown };
    readonly activationEvents?: unknown;
    readonly contributes?: {
      readonly configurationDefaults?: {
        readonly 'workbench.editorAssociations'?: Record<string, string>;
        readonly 'workbench.diffEditorAssociations'?: Record<string, string>;
      };
      readonly configuration?: {
        readonly properties?: Record<string, unknown>;
      };
      readonly languages?: Array<{
        readonly id?: unknown;
        readonly extensions?: unknown;
      }>;
      readonly commands?: Array<{
        readonly command?: unknown;
        readonly title?: unknown;
      }>;
      readonly menus?: Record<
        string,
        Array<{
          readonly command?: unknown;
          readonly when?: unknown;
        }>
      >;
      readonly customEditors?: Array<{
        readonly viewType?: unknown;
        readonly priority?: unknown;
        readonly selector?: Array<{ readonly filenamePattern?: unknown }>;
      }>;
    };
  };

  assert.equal(
    packageJson.contributes?.configurationDefaults?.[
      'workbench.editorAssociations'
    ]?.['*.csv'],
    'quickCsvViewer.viewer'
  );
  assert.equal(
    packageJson.contributes?.configurationDefaults?.[
      'workbench.diffEditorAssociations'
    ]?.['*.csv'],
    'default'
  );
  assert.equal(packageJson.engines?.vscode, '^1.120.0');

  const openCommand = packageJson.contributes?.commands?.find(
    (command) => command.command === 'quickCsvViewer.openCurrentFile'
  );
  assert.equal(openCommand?.title, 'Open in Quick CSV Viewer');

  const commandPaletteEntry = packageJson.contributes?.menus?.[
    'commandPalette'
  ]?.find((entry) => entry.command === 'quickCsvViewer.openCurrentFile');
  assert.equal(commandPaletteEntry?.when, '!isInDiffEditor');

  const editorTitleEntry = packageJson.contributes?.menus?.[
    'editor/title'
  ]?.find((entry) => entry.command === 'quickCsvViewer.openCurrentFile');
  assert.equal(
    editorTitleEntry?.when,
    'resourceScheme == file && resourceExtname == .csv && !isInDiffEditor'
  );

  const explorerContextEntry = packageJson.contributes?.menus?.[
    'explorer/context'
  ]?.find((entry) => entry.command === 'quickCsvViewer.openCurrentFile');
  assert.equal(
    explorerContextEntry?.when,
    'resourceScheme == file && resourceExtname == .csv'
  );

  const customEditor = packageJson.contributes?.customEditors?.find(
    (editor) => editor.viewType === 'quickCsvViewer.viewer'
  );

  assert.equal(customEditor?.priority, 'default');
  assert.ok(
    customEditor?.selector?.some(
      (selector) => selector.filenamePattern === '*.csv'
    )
  );
  assert.ok(Array.isArray(packageJson.activationEvents));
  assert.ok(
    packageJson.activationEvents.includes(
      'onCommand:quickCsvViewer.openSampleFiles'
    )
  );
  assert.ok(!packageJson.activationEvents.includes('onLanguage:csv'));
  assert.ok(
    packageJson.contributes?.languages?.some(
      (language) =>
        language.id === 'csv' &&
        Array.isArray(language.extensions) &&
        language.extensions.includes('.csv')
    )
  );
  assert.equal(
    typeof packageJson.contributes?.configuration?.properties?.[
      'quickCsvViewer.maxRows'
    ],
    'object'
  );
  assert.equal(
    typeof packageJson.contributes?.configuration?.properties?.[
      'quickCsvViewer.firstRowIsHeader'
    ],
    'object'
  );
  assert.equal(
    typeof packageJson.contributes?.configuration?.properties?.[
      'quickCsvViewer.wrapCellContents'
    ],
    'object'
  );
});

test('package wires local test hooks, formatting, and GitHub Actions test workflow', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, 'utf8')
  ) as {
    readonly scripts?: Record<string, unknown>;
    readonly devDependencies?: Record<string, unknown>;
  };

  assert.equal(packageJson.scripts?.['clean'], 'node scripts/clean.cjs');
  assert.equal(packageJson.scripts?.['compile'], 'tsc -p ./');
  assert.equal(
    packageJson.scripts?.['compile:clean'],
    'npm run clean && npm run compile'
  );
  assert.equal(
    packageJson.scripts?.['test'],
    'npm run format:check && npm run compile:clean && npm run test:coverage'
  );
  assert.equal(
    packageJson.scripts?.['test:unit'],
    'node scripts/run-tests.cjs'
  );
  assert.equal(
    packageJson.scripts?.['test:coverage'],
    "node scripts/prepare-private-coverage.cjs && c8 --all --src out/src --include 'out/src/**/*.js' --exclude 'out/src/**/types.js' --check-coverage --statements 100 --lines 100 --branches 100 --functions 100 npm run test:unit"
  );
  assert.equal(
    packageJson.scripts?.['test:vscode'],
    'npm run compile:clean && vscode-test'
  );
  assert.equal(
    packageJson.scripts?.['format'],
    'prettier . --write --ignore-unknown'
  );
  assert.equal(
    packageJson.scripts?.['format:check'],
    'prettier . --check --ignore-unknown'
  );
  assert.equal(packageJson.scripts?.['prepare'], 'husky');
  assert.equal(typeof packageJson.devDependencies?.['@types/mocha'], 'string');
  assert.equal(
    typeof packageJson.devDependencies?.['@vscode/test-cli'],
    'string'
  );
  assert.equal(
    typeof packageJson.devDependencies?.['@vscode/test-electron'],
    'string'
  );
  assert.equal(typeof packageJson.devDependencies?.['c8'], 'string');
  assert.equal(typeof packageJson.devDependencies?.['husky'], 'string');
  assert.equal(typeof packageJson.devDependencies?.['mocha'], 'string');
  assert.equal(typeof packageJson.devDependencies?.['prettier'], 'string');

  const preCommitHook = await fs.readFile(
    path.join(process.cwd(), '.husky', 'pre-commit'),
    'utf8'
  );
  assert.match(preCommitHook, /npm test/);

  const workflow = await fs.readFile(
    path.join(process.cwd(), '.github', 'workflows', 'test.yml'),
    'utf8'
  );
  assert.match(workflow, /HUSKY: 0/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /xvfb-run -a npm run test:vscode/);
});
