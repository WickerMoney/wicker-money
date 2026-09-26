import { createContext } from 'react'
import type { AuthState } from './AuthState.js'

/** The React context that carries {@link AuthState}. Read it through `useAuth`, not directly. */
export const AuthCtx = createContext<AuthState | null>(null)
