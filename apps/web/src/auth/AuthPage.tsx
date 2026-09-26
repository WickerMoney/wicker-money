import { useState, type FormEvent } from 'react'
import { Alert, Button, Field, Surface } from '@wickermoney/ui-kit'
import { useAuth } from './useAuth.js'

/**
 * Sign in, or create the first account.
 *
 * Both live on one screen: a self-hosted instance starts empty, and a login
 * form with no way to register is a dead end on first run.
 */
export function AuthPage() {
  const { signIn, register } = useAuth()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await (mode === 'signin' ? signIn(email, password) : register(email, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <div className="auth__panel">
        <Surface title={mode === 'signin' ? 'Sign in to Wicker Money' : 'Create your account'}>
          <form onSubmit={submit}>
            <Field label="Email" type="email" autoComplete="email" required
                   value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field label="Password" type="password" required
                   autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'register' ? (
              <p className="auth__hint">At least 12 characters. A passphrase is easiest.</p>
            ) : null}
            {error !== null ? <Alert>{error}</Alert> : null}
            <div className="auth__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </Button>
              <Button onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(null) }}>
                {mode === 'signin' ? 'Create an account' : 'I already have an account'}
              </Button>
            </div>
          </form>
        </Surface>
      </div>
    </main>
  )
}
