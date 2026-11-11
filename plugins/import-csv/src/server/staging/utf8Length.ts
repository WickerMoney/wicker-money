/**
 * The UTF-8 length of a chunk of text, counting a split surrogate pair once.
 *
 * A client that cuts a string by character count can cut an astral character
 * (an emoji, say) between its two UTF-16 halves. `Buffer.byteLength` counts
 * each lone half as the 3 bytes of a replacement character, so the two chunks
 * would add up to 6 bytes for a character that is 4 in the file. A leading low
 * half and a trailing high half are counted as 2 bytes each, so the chunks of
 * a correctly split file add up to the file's size. A lone half that is never
 * completed is refused later, when the joined text is checked.
 *
 * @param text - One chunk.
 * @returns Its length in bytes of UTF-8.
 */
export function utf8Length(text: string): number {
  let bytes = Buffer.byteLength(text, 'utf8')
  if (text.length === 0) return bytes
  const first = text.charCodeAt(0)
  if (first >= 0xdc00 && first <= 0xdfff) bytes -= 1
  const last = text.charCodeAt(text.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) bytes -= 1
  return bytes
}
