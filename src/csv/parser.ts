export function parseCsvRecordsFromText(input: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let fieldAtStart = true;
  let inQuotes = false;
  let quotePending = false;
  let pendingCarriageReturn = false;
  let recordHasCharacters = false;

  const appendFieldCharacter = (value: string): void => {
    field += value;
    fieldAtStart = false;
    recordHasCharacters = true;
  };

  const endRecord = (force: boolean): void => {
    if (!force && !recordHasCharacters && row.length === 0 && field === '') {
      return;
    }

    row.push(field);
    records.push(row);
    row = [];
    field = '';
    fieldAtStart = true;
    recordHasCharacters = false;
  };

  const processOutsideQuotes = (char: string): void => {
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      if (char === '\n') {
        endRecord(true);
        return;
      }

      endRecord(true);
    }

    if (char === ',') {
      row.push(field);
      field = '';
      fieldAtStart = true;
      recordHasCharacters = true;
      return;
    }

    if (char === '\r') {
      pendingCarriageReturn = true;
      return;
    }

    if (char === '\n') {
      endRecord(true);
      return;
    }

    if (char === '"' && fieldAtStart) {
      inQuotes = true;
      fieldAtStart = false;
      recordHasCharacters = true;
      return;
    }

    appendFieldCharacter(char);
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index);

    if (inQuotes) {
      if (quotePending) {
        if (char === '"') {
          appendFieldCharacter('"');
          quotePending = false;
          continue;
        }

        quotePending = false;
        inQuotes = false;
        processOutsideQuotes(char);
        continue;
      }

      if (char === '"') {
        quotePending = true;
        continue;
      }

      appendFieldCharacter(char);
      continue;
    }

    processOutsideQuotes(char);
  }

  if (pendingCarriageReturn) {
    pendingCarriageReturn = false;
    endRecord(true);
  } else {
    quotePending = false;
    inQuotes = false;
    endRecord(false);
  }

  return records;
}

export function normalizeHeaders(
  headerFields: readonly string[],
  columnCount: number
): string[] {
  return Array.from({ length: columnCount }, (_, index) => {
    const value = headerFields[index];
    return value && value.trim() !== '' ? value : `Column ${index + 1}`;
  });
}

export function normalizeCells(
  fields: readonly string[],
  columnCount: number
): string[] {
  return Array.from({ length: columnCount }, (_, index) => fields[index] ?? '');
}
