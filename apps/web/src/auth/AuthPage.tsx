import { useState, type FormEvent } from 'react'
import {
  Button, Field, FormError, Surface, formErrorsFrom, hasFormErrors, useFormErrors,
} from '@wickermoney/ui-kit'
import { REQUIRED_MESSAGE, fieldErrors } from '../lib/fieldChecks.js'
import { useAuth } from './useAuth.js'

/** The API's shortest password for a new account. */
const MIN_PASSWORD = 12

/**
 * Something@something, which is all a browser check should insist on. The
 * API's own check is stricter and its answer is shown on the same field.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+$/

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
  const form = useFormErrors()
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problems = fieldErrors({
      email: email.trim() === ''
        ? REQUIRED_MESSAGE
        : LOOKS_LIKE_EMAIL.test(email.trim()) ? undefined : 'Must be an email address.',
      // Only a new password has a minimum; an existing one is whatever it is.
      password: password === ''
        ? REQUIRED_MESSAGE
        : mode === 'register' && password.length < MIN_PASSWORD
          ? `Password must be at least ${MIN_PASSWORD} characters.`
          : undefined,
    })
    form.show(problems)
    if (hasFormErrors(problems)) return
    setBusy(true)
    try {
      await (mode === 'signin' ? signIn(email, password) : register(email, password))
    } catch (err) {
      form.show(formErrorsFrom(err, ['email', 'password'], 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <div className="auth__panel">
        <Surface level={1} title={mode === 'signin' ? 'Sign in to Wicker Money' : 'Create your account'}>
          <form onSubmit={submit} ref={form.ref} noValidate>
            <Field label="Email" type="email" autoComplete="email" required
                   value={email} error={form.errors.fields['email']}
                   onChange={(e) => { setEmail(e.target.value); form.clearField('email') }} />
            <Field label="Password" type="password" required
                   autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                   value={password} error={form.errors.fields['password']}
                   onChange={(e) => { setPassword(e.target.value); form.clearField('password') }} />
            {mode === 'register' ? (
              <p className="auth__hint">At least 12 characters. A passphrase is easiest.</p>
            ) : null}
            <FormError message={form.errors.form} />
            <div className="auth__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </Button>
              <Button onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); form.clear() }}>
                {mode === 'signin' ? 'Create an account' : 'I already have an account'}
              </Button>
            </div>
          </form>
        </Surface>
      </div>
    </main>
  )
}
