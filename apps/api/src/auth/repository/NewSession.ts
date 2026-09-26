/** A session to create for a freshly issued refresh token; it starts a new family. */
export interface NewSession {
  /** Owner of the session. */
  readonly userId: string
  /** Digest of the refresh token; the token itself is never stored. */
  readonly tokenHash: string
  /** When the refresh token stops being accepted. */
  readonly expiresAt: Date
}
