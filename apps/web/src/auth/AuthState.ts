import type { CurrentUser } from './CurrentUser.js'

/** What {@link useAuth} exposes to components. */
export interface AuthState {
  /** The signed-in user, or `null` when signed out. */
  readonly user: CurrentUser | null
  /** `false` until the attempt to resume an existing session has finished. */
  readonly ready: boolean
  /** Signs in with an email and password; rejects with an `ApiError` on bad credentials. */
  readonly signIn: (email: string, password: string) => Promise<void>
  /** Creates an account and signs it in; rejects with an `ApiError` if the email is taken or invalid. */
  readonly register: (email: string, password: string) => Promise<void>
  /** Ends the session on the server and always clears it locally, even if the request fails. */
  readonly signOut: () => Promise<void>
}
