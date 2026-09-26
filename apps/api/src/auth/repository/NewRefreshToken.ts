/** A refresh token that replaces one being rotated. */
export interface NewRefreshToken {
  /** Digest of the new refresh token; the token itself is never stored. */
  readonly tokenHash: string
  /** When the new refresh token stops being accepted. */
  readonly expiresAt: Date
}
