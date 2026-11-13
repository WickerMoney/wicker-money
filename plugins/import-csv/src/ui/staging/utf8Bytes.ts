const encoder = new TextEncoder()

/**
 * The exact size of text in bytes of UTF-8, which is what the server counts.
 * `File.size` is not it: the browser decodes the file (a byte order mark is
 * dropped, bad bytes become U+FFFD), so the text can be a different length.
 *
 * @param text - The text.
 * @returns Its length in bytes once encoded.
 */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length
}
