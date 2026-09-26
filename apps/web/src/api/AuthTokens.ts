/**
 * The credential the client attaches to requests.
 *
 * Only the short-lived access token is ever held by the page, and only in
 * memory. The refresh token lives in an HttpOnly cookie that script cannot read.
 */
export interface AuthTokens {
  /** Short-lived; sent as the bearer credential on every authenticated request. */
  readonly accessToken: string
}
