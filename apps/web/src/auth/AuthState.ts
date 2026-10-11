import type { CurrentUser } from './CurrentUser.js'

/** What {@link useAuth} exposes to components. */
export interface AuthState {
  /** The signed-in user, or `null` when signed out. */
  readonly user: CurrentUser | null
  /** `false` until the attempt to resume an existing session has finished. */
  readonly ready: boolean
  /** Signs in with an email and password; rejects with an `ApiError` on bad credentials. */
  readonly signIn: (email: string, password: string) => Promise<void>
  /**
   * Creates an account and signs it in; rejects with an `ApiError` if the
   * email is taken or invalid. Sends the browser's time zone along, so "today"
   * is right from the first sign-in.
   */
  readonly register: (email: string, password: string) => Promise<void>
  /**
   * Sets the account's time zone on the server and updates `user` to match;
   * rejects with an `ApiError` if the server refuses the zone.
   */
  readonly setTimezone: (timezone: string) => Promise<void>
  /**
   * Re-reads the signed-in user from the server and updates `user` to match.
   * For after something changed the account from outside this component, such
   * as an owner changing their own role: the role the app holds decides which
   * controls it offers, and the server only ever reports a role fresh.
   */
  readonly refreshUser: () => Promise<void>
  /** Ends the session on the server and always clears it locally, even if the request fails. */
  readonly signOut: () => Promise<void>
}
