/** The signed-in user, as returned by the auth endpoints. */
export interface CurrentUser {
  /** The user id. */
  readonly id: string
  /** The sign-in email address. */
  readonly email: string
  /** IANA time zone name used to decide where one day or month ends. */
  readonly timezone: string
  /**
   * What the account may do on this instance: an `owner` administers it
   * (plugins, for example), a `member` does not. Decides which controls the
   * app offers; the server checks the role again on every owner-only request.
   */
  readonly role: 'owner' | 'member'
}
