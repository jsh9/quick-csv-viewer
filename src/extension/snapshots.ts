import * as nodeFs from 'node:fs';

export interface FileSnapshot {
  readonly size: number;
  readonly mtimeMs: number;
}

export function getFileSnapshot(
  stats: Pick<nodeFs.Stats, 'size' | 'mtimeMs'>
): FileSnapshot {
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

export function isSameFileSnapshot(
  left: FileSnapshot,
  right: FileSnapshot
): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}
