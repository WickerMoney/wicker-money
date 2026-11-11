/** Limits and clock of an {@link UploadStore}; every field has the production default and exists so tests can shrink or fake it. */
export interface UploadStoreOptions {
  /** Live uploads per user. */
  readonly maxLivePerUser?: number
  /** Declared bytes across every user's live uploads. */
  readonly maxTotalBytes?: number
  /** Milliseconds an upload lives after its last new chunk. */
  readonly ttlMs?: number
  /** The current time in milliseconds. Read on every call, so a test may fake `Date`. */
  readonly now?: () => number
}
