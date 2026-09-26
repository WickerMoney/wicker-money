/** The signed-in user as reported to the client. */
export interface AuthUser {
  /** User id. */
  readonly id: string
  /** Normalised email address. */
  readonly email: string
  /** IANA time zone name. */
  readonly timezone: string
}
