import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CSRF_HEADERS, api, resumeSession, setAccessToken, setUnauthorizedHandler } from '../api/client.js'
import { browserTimezone } from '../lib/browserTimezone.js'
import type { AuthResult } from './AuthResult.js'
import { AuthCtx } from './authContext.js'
import type { AuthState } from './AuthState.js'
import type { CurrentUser } from './CurrentUser.js'

/** Props for {@link AuthProvider}. */
export interface AuthProviderProps {
  /** The subtree that can call `useAuth`. */
  readonly children: ReactNode
}

/**
 * Provides session state to the tree and resumes an existing session on load.
 *
 * Nothing about the session is persisted by the page. The refresh token is an
 * HttpOnly cookie the browser sends on its own, so resuming is a single
 * refresh call: it succeeds if the cookie is still good and fails otherwise.
 * The access token stays in memory.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [ready, setReady] = useState(false)

  const adopt = useCallback((result: AuthResult) => {
    setAccessToken(result.accessToken)
    setUser(result.user)
  }, [])

  const clear = useCallback(() => {
    setAccessToken(null)
    setUser(null)
  }, [])

  useEffect(() => { setUnauthorizedHandler(clear) }, [clear])

  // Resume an existing session on load.
  useEffect(() => {
    let live = true
    resumeSession<AuthResult>()
      .then((result) => { if (live && result !== null) setUser(result.user) })
      .catch(() => { /* Server unreachable: show the sign-in page rather than hang. */ })
      .finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      signIn: async (email, password) => {
        adopt(await api.post<AuthResult>('/auth/login', { email, password }, { anonymous: true }))
      },
      register: async (email, password) => {
        const timezone = browserTimezone()
        adopt(await api.post<AuthResult>(
          '/auth/register',
          timezone === undefined ? { email, password } : { email, password, timezone },
          { anonymous: true },
        ))
      },
      setTimezone: async (timezone) => {
        setUser(await api.patch<CurrentUser>('/auth/me', { timezone }))
      },
      refreshUser: async () => {
        setUser(await api.get<CurrentUser>('/auth/me'))
      },
      signOut: async () => {
        try {
          await api.post('/auth/logout', undefined, { headers: CSRF_HEADERS })
        } finally {
          clear()
        }
      },
    }),
    [user, ready, adopt, clear],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
