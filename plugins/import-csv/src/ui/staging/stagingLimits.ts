import { MAX_UPLOAD_BYTES, MAX_UPLOAD_CHUNKS } from '../../server/staging/limits.js'

export { MAX_UPLOAD_BYTES, MAX_UPLOAD_CHUNKS }

/**
 * About how many characters of CSV one chunk carries. A chunk's request body
 * is JSON, which escapes every quote and line break, so the real limit is
 * {@link MAX_CHUNK_JSON_BYTES}: a chunk is cut shorter than this when its
 * escaped form would be larger.
 */
export const CHUNK_TARGET_CHARS = 200_000

/**
 * The most bytes one chunk's JSON text may have: 240,000, clearly under the
 * 262,144 (256 KiB) the plugin broker accepts for a request body, which also
 * has to hold the upload id and the chunk's index. The broker counts a body over
 * its limit as a strike against the frame, so the limit is kept with room.
 */
export const MAX_CHUNK_JSON_BYTES = 240_000

/** Chunk requests in flight at once. Well under the broker's 12 in flight, which the rest of the page also uses. */
export const CHUNKS_IN_FLIGHT = 6

/**
 * The pacing bucket for a frame's requests: 30 at once and 15 a second. The
 * broker allows a burst of 40 and 20 a second per frame, so this leaves it
 * room for the page's own reads and size reports. A 100,000-row file is 38
 * requests.
 */
export const PACE_BURST = 30
export const PACE_PER_SECOND = 15

/** Times a chunk, `begin` or `finish` is sent again after a failed or refused request, and the waits between, in milliseconds. */
export const RETRY_WAITS_MS: readonly number[] = [400, 1200]
