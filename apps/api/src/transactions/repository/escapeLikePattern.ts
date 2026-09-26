/**
 * Escapes the characters that are special in a SQL `LIKE`/`ILIKE` pattern, so a
 * user-supplied term matches literally.
 *
 * Without this a search for `50%` matches everything containing `50`, and a
 * lone `%` or `_` matches every row.
 *
 * @param term - Raw search text.
 * @returns The text with `\`, `%` and `_` each prefixed by a backslash.
 * @example
 * escapeLikePattern('100%_off') // '100\\%\\_off'
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&')
}
