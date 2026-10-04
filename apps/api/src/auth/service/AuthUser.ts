import type { UserRole } from '../../db/models/index.js'

/** The signed-in user as reported to the client. */
export interface AuthUser {
  /** User id. */
  readonly id: string
  /** Normalised email address. */
  readonly email: string
  /** IANA time zone name. */
  readonly timezone: string
  /**
   * What the account may do on this instance: `owner` administers it,
   * `member` does not. Read fresh on every response, not taken from the
   * token. For display only; the server checks the role itself on every
   * owner-only request.
   */
  readonly role: UserRole
}
