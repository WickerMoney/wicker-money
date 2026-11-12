import { CHUNK_TARGET_CHARS, MAX_CHUNK_JSON_BYTES } from './stagingLimits.js'
import { utf8Bytes } from './utf8Bytes.js'

/** Bytes of the JSON text a string becomes in a request body (its quotes and escapes included). */
function jsonBytes(text: string): number {
  return utf8Bytes(JSON.stringify(text))
}

/** Moves a cut back by one when it would fall between the two halves of a surrogate pair. */
function outsidePair(text: string, start: number, end: number): number {
  if (end <= start + 1 || end >= text.length) return end
  const low = text.charCodeAt(end)
  const high = text.charCodeAt(end - 1)
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? end - 1 : end
}

/**
 * Cuts text into pieces to send one request each.
 *
 * A piece is about `targetChars` characters, and shorter when its JSON text
 * would be longer than `maxJsonBytes`: a CSV with every field quoted grows by a
 * fifth once its quotes are escaped, and text outside ASCII takes up to three
 * bytes a character. Counting characters alone would send a request the broker
 * refuses. A piece never ends inside a surrogate pair, so each is well-formed
 * text of its own. Joining the pieces gives the text back.
 *
 * @param text - The text to cut.
 * @param targetChars - How long a piece usually is, in UTF-16 code units.
 * @param maxJsonBytes - The most bytes a piece's JSON text may have.
 * @returns The pieces, in order; empty for empty text.
 */
export function splitIntoChunks(
  text: string,
  targetChars: number = CHUNK_TARGET_CHARS,
  maxJsonBytes: number = MAX_CHUNK_JSON_BYTES,
): string[] {
  const pieces: string[] = []
  let start = 0
  while (start < text.length) {
    let end = outsidePair(text, start, Math.min(text.length, start + targetChars))
    for (;;) {
      const size = jsonBytes(text.slice(start, end))
      if (size <= maxJsonBytes || end - start <= 2) break
      // Shorter by the ratio it was over, a little more, so one more pass is almost always the last.
      end = outsidePair(text, start, start + Math.max(2, Math.floor((end - start) * (maxJsonBytes / size) * 0.97)))
    }
    pieces.push(text.slice(start, end))
    start = end
  }
  return pieces
}
