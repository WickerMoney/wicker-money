/**
 * The page the feedback browser check drives: the real AppShell, the real
 * Accounts and Settings pages, app.css and ui-kit, with a stand-in account menu
 * and a fake sign-in. The API is answered by the check itself (Playwright route
 * handlers), so no server and no database are needed.
 */
import { createRoot } from 'react-dom/client'
import { useMemo, useState, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { ToastProvider } from '@wickermoney/ui-kit'
import { api, setAccessToken } from '../../src/api/client.js'
import { AuthCtx } from '../../src/auth/authContext.js'
import type { AuthState } from '../../src/auth/AuthState.js'
import type { CurrentUser } from '../../src/auth/CurrentUser.js'
import { AccountsPage } from '../../src/pages/Accounts/index.js'
import { CategoriesPage } from '../../src/pages/Categories/index.js'
import { SettingsPage } from '../../src/pages/Settings/index.js'
import { OnboardingProvider } from '../../src/onboarding/index.js'
import { PluginRegistryCtx } from '../../src/plugins/registry/pluginRegistryContext.js'
import { AppShell } from '../../src/shell/AppShell.js'
// Imported by path: the package's own `sideEffects` list does not name src/, so a bundle
// that reaches ui-kit through the alias would drop the CSS imports in its index.ts.
import '../../../../packages/ui-kit/src/tokens.css'
import '../../../../packages/ui-kit/src/components.css'
import '../../src/app.css'

/** A token the client accepts without refreshing: unsigned, far from expiry, subject `u1`. */
const b64 = (o: object): string => btoa(JSON.stringify(o)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
setAccessToken(`${b64({ alg: 'none' })}.${b64({ sub: 'u1', exp: 4_102_444_800 })}.x`)

function Auth({ children }: { readonly children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser>({ id: 'u1', email: 'owner@example.com', timezone: 'UTC', role: 'owner' })
  const value = useMemo<AuthState>(() => ({
    user, ready: true,
    signIn: async () => undefined, register: async () => undefined, signOut: async () => undefined,
    refreshUser: async () => { setUser(await api.get<CurrentUser>('/auth/me')) },
    setTimezone: async (timezone) => { setUser(await api.patch<CurrentUser>('/auth/me', { timezone })) },
  }), [user])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Auth>
      <PluginRegistryCtx.Provider value={{ plugins: [], failures: [], refresh: async () => undefined }}>
        <OnboardingProvider>
          <ToastProvider>
            <Routes>
              <Route element={<AppShell plugins={[]} />}>
                <Route path="accounts" element={<AccountsPage />} />
                <Route path="categories" element={<CategoriesPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </OnboardingProvider>
      </PluginRegistryCtx.Provider>
    </Auth>
  </BrowserRouter>,
)
