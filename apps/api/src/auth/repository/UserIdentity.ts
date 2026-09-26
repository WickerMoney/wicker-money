/** The public identity of an account, as returned when one is created or authenticated. */
export interface UserIdentity {
  /** User id. */
  readonly id: string
  /** Normalised (trimmed, lower-cased) email address. */
  readonly email: string
  /** IANA time zone name. */
  readonly timezone: string
}
