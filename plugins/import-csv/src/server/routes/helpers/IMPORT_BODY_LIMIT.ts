/**
 * Largest request body, in bytes, the analyze and commit routes accept.
 *
 * Sits above `MAX_CSV_BYTES` so JSON escaping (every quote and newline in the
 * CSV grows by a byte) does not turn an allowed file into a `413`.
 */
export const IMPORT_BODY_LIMIT = 10 * 1024 * 1024
