/** The signed-in user, as returned by the auth endpoints. */
export interface CurrentUser {
  /** The user id. */
  readonly id: string
  /** The sign-in email address. */
  readonly email: string
  /** IANA time zone name used to decide where one day or month ends. */
  readonly timezone: string
}
