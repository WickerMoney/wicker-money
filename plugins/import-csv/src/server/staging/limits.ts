import { MAX_CSV_BYTES } from '../routes/helpers/MAX_CSV_BYTES.js'

/** Most live (receiving or complete, not yet imported) staged uploads one user may hold. */
export const MAX_LIVE_UPLOADS_PER_USER = 2

/** Most chunks one staged upload may be declared in. */
export const MAX_UPLOAD_CHUNKS = 64

/** Largest staged upload, in bytes of UTF-8: the same ceiling as a `csv` body. */
export const MAX_UPLOAD_BYTES = MAX_CSV_BYTES

/**
 * Largest single chunk, in bytes of UTF-8: 256 KiB, the plugin broker's body
 * cap. A chunk of about 200,000 characters of CSV fits with room for the JSON
 * envelope and escaping.
 */
export const MAX_CHUNK_BYTES = 256 * 1024

/**
 * Largest request body the chunk route reads, in bytes. A chunk of
 * `MAX_CHUNK_BYTES` can grow when JSON escapes its quotes and newlines, so the
 * body limit sits well above it; the chunk itself is measured after parsing.
 */
export const CHUNK_BODY_LIMIT = 1024 * 1024

/**
 * How long a staged upload lives after its last new chunk, in milliseconds
 * (15 minutes). `begin` counts as the first activity.
 */
export const UPLOAD_TTL_MS = 15 * 60 * 1000

/**
 * Most bytes of staged text all users together may hold in this process:
 * 64,000,000, eight uploads of the largest size.
 *
 * Counted as the sizes uploads declared at `begin`, so a refusal comes before
 * any data is sent. The text lives as JavaScript strings, which take one byte
 * a character for Latin-1 text (typical bank CSV) and two for anything else, so
 * the real heap use is between 1x and 2x this number, and 2x again for the
 * moment `finish` joins one upload's chunks. That is about 64 MB typical, 128
 * MB worst case in steady state: well under the 190 to 300 MB one 100,000-row
 * `analyze` already adds, and per process like the other import limits.
 */
export const MAX_STAGED_BYTES_TOTAL = 8 * MAX_UPLOAD_BYTES

/** Receipts of committed uploads kept per user, for retrying a commit whose answer was lost. */
export const MAX_RECEIPTS_PER_USER = 8

/** How often idle expired uploads are swept when no request arrives, in milliseconds. */
export const SWEEP_INTERVAL_MS = 60_000
