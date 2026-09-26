/**
 * Finds a header by name, ignoring case.
 *
 * @param headers - The CSV's header names.
 * @param name - The header to look for.
 * @returns Its position, or `-1` when the name is unset or absent.
 */
export function columnIndex(headers: readonly string[], name: string | undefined): number {
  if (name === undefined || name === '') return -1
  return headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
}
