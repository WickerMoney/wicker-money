/**
 * The largest snapshot payload, in bytes of its JSON text (256 KiB). Migration
 * 039's CHECK constraint says the same number; a delete whose snapshot would be
 * over it still deletes, and gets no Undo.
 */
export const UNDO_PAYLOAD_MAX_BYTES = 262_144
