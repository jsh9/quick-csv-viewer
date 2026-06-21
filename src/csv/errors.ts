export class CsvOperationCancelledError extends Error {
  public constructor() {
    super('Operation cancelled.');
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof CsvOperationCancelledError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CsvOperationCancelledError();
  }
}
