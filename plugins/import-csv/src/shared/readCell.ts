/**
 * Reads one trimmed cell of a row.
 *
 * @param raw - The row's cells.
 * @param index - The column position, or `-1` for "no such column".
 * @returns The trimmed text, or an empty string when the column is absent or the row is short.
 */
export function readCell(raw: readonly string[], index: number): string {
  return index === -1 ? '' : (raw[index] ?? '').trim()
}
