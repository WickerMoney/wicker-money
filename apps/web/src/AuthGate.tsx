import { Spinner } from '@wickermoney/ui-kit'
import { AuthPage, useAuth } from './auth/index.js'
import { AuthenticatedApp } from './AuthenticatedApp.js'

/**
 * Chooses what to render from the session state: a spinner while an existing
 * session is being resumed, the sign-in page when signed out, otherwise the app.
 */
export function AuthGate() {
  const { user, ready } = useAuth()
  if (!ready) return <div className="boot"><Spinner label="Starting" /></div>
  return user === null ? <AuthPage /> : <AuthenticatedApp />
}
