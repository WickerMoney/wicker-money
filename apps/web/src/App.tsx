import { BrowserRouter } from 'react-router'
import { AuthProvider } from './auth/index.js'
import { AuthGate } from './AuthGate.js'
import './app.css'

/** The application root: router, session provider and the sign-in gate. */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  )
}
