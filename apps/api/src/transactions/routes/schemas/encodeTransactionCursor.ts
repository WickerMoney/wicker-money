/**
 * Encodes a cursor into the opaque string clients send back: base64url of a
 * JSON object with the sort, its direction, the last row's sort value and its
 * id, in that order.
 *
 * @param cursor - The position to encode.
 * @returns A URL-safe string with no padding.
 */
export function encodeTransactionCursor(cursor: {
  readonly sort: string
  readonly direction: string
  readonly value: string
  readonly id: string
}): string {
  const { sort, direction, value, id } = cursor
  return Buffer.from(JSON.stringify({ sort, direction, value, id }), 'utf8').toString('base64url')
}
