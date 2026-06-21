import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import * as path from 'node:path';
import * as vm from 'node:vm';

export interface PrivateModuleOptions {
  readonly footer?: string;
  readonly requireOverrides?: Record<string, unknown>;
  readonly transform?: (source: string) => string;
}

interface PrivateCommonJsModule {
  exports: unknown;
}

export function loadPrivateModule<T>(
  compiledRelativePath: string,
  options: PrivateModuleOptions = {}
): T {
  const filename = path.join(process.cwd(), 'out', 'src', compiledRelativePath);
  let source = fs.readFileSync(filename, 'utf8');

  if (options.footer) {
    source = insertBeforeSourceMap(source, `\n${options.footer}\n`);
  }

  if (options.transform) {
    source = options.transform(source);
  }

  const realRequire = createRequire(filename);
  const overrides = options.requireOverrides ?? {};
  const localRequire = (request: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) {
      return overrides[request];
    }

    return realRequire(request);
  };
  const privateModule: PrivateCommonJsModule = { exports: {} };
  const wrappedSource = `(function (exports, require, module, __filename, __dirname) {\n${source}\n});`;
  const script = new vm.Script(wrappedSource, { filename });
  const compiledWrapper = script.runInThisContext() as (
    exports: unknown,
    require: (request: string) => unknown,
    module: PrivateCommonJsModule,
    __filename: string,
    __dirname: string
  ) => void;

  const moduleLoader = Module as unknown as {
    _load(
      this: unknown,
      request: string,
      parent: unknown,
      isMain: boolean
    ): unknown;
  };
  const originalLoad = moduleLoader._load;

  moduleLoader._load = function (
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) {
      return overrides[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    compiledWrapper(
      privateModule.exports,
      localRequire,
      privateModule,
      filename,
      path.dirname(filename)
    );
  } finally {
    moduleLoader._load = originalLoad;
  }

  return privateModule.exports as T;
}

export function requireCompiledModule<T>(
  compiledRelativePath: string,
  requireOverrides: Record<string, unknown> = {}
): T {
  const filename = path.join(process.cwd(), 'out', 'src', compiledRelativePath);
  const moduleLoader = Module as unknown as {
    _load(
      this: unknown,
      request: string,
      parent: unknown,
      isMain: boolean
    ): unknown;
  };
  const originalLoad = moduleLoader._load;

  moduleLoader._load = function (
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (Object.prototype.hasOwnProperty.call(requireOverrides, request)) {
      return requireOverrides[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[filename];
    return require(filename) as T;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

export function replaceOnce(
  source: string,
  search: string,
  replacement: string
): string {
  if (source.includes(replacement)) {
    return source;
  }

  if (!source.includes(search)) {
    throw new Error(`Expected compiled source to contain: ${search}`);
  }

  return source.replace(search, replacement);
}

function insertBeforeSourceMap(source: string, insertion: string): string {
  const marker = '\n//# sourceMappingURL=';
  const index = source.lastIndexOf(marker);

  if (index < 0) {
    return `${source}${insertion}`;
  }

  return `${source.slice(0, index)}${insertion}${source.slice(index)}`;
}
