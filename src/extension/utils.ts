export function clampMessageInteger(
  value: unknown,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatBulletedList(items: readonly string[]): string {
  // Keep one bullet per item even when a CSV header field spans lines, and
  // drop the byte order mark that a UTF-8 BOM file leaves on its first field.
  return items
    .map(
      (item) =>
        `• ${item.replace(/^\uFEFF/, '').replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, ' ')}`
    )
    .join('\n');
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
