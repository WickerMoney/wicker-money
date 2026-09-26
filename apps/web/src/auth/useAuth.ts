import { useContext } from 'react'
import { AuthCtx } from './authContext.js'
import type { AuthState } from './AuthState.js'

/**
 * Reads the current session.
 *
 * @returns The signed-in state and its sign-in, sign-out and registration actions.
 * @throws {Error} If called outside an `AuthProvider`.
 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>.')
  return ctx
}
