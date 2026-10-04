import { useCallback, useEffect, useRef } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { Alert } from '@wickermoney/ui-kit'
import { useAuth } from './auth/index.js'
import { SetupWizard, OnboardingProvider } from './onboarding/index.js'
import { AccountsPage } from './pages/Accounts/index.js'
import { CategoriesPage } from './pages/Categories/index.js'
import { Dashboard } from './pages/Dashboard/index.js'
import { SettingsPage } from './pages/Settings/index.js'
import { TransactionsPage } from './pages/Transactions/index.js'
import { RecurringPage } from './pages/Recurring/index.js'
import { buildPluginContext } from './plugins/context.js'
import { PluginUnavailable } from './plugins/PluginUnavailable.js'
import { pluginRoutes } from './plugins/PluginRoutes.js'
import { usePluginRegistry } from './plugins/registry/index.js'
import { useCachedContextFor } from './plugins/useCachedContextFor.js'
import { AppShell } from './shell/AppShell.js'

/**
 * The shell and every core and plugin route, built from the current plugin
 * registry.
 *
 * Nothing here holds plugins of its own: navigation, routes and dashboard
 * widgets are all derived from `usePluginRegistry()`, so when the registry
 * changes a disabled plugin unmounts everywhere and an enabled one mounts.
 * A plugin page's address with no plugin behind it falls through to
 * {@link PluginUnavailable} rather than "Not found".
 *
 * Must be rendered inside a router, an `AuthProvider` with a signed-in user,
 * and a `PluginRegistryProvider`.
 */
export function AuthenticatedRoutes() {
  const { user } = useAuth()
  const { plugins, failures } = usePluginRegistry()
  const navigate = useNavigate()

  // `navigate` changes identity with the location; reading it through a ref
  // keeps every plugin context stable across in-app navigation.
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  const buildContext = useCallback(
    (manifest: PluginManifest) => buildPluginContext(manifest, user!, (p) => navigateRef.current(p)),
    [user],
  )
  const contextFor = useCachedContextFor(buildContext)

  return (
    <OnboardingProvider>
      {/* Above the routes, so it covers whatever page the user first landed on
          rather than only the one that happens to own categories. */}
      <SetupWizard />
      {failures.length > 0 ? (
        <div className="shell__failures">
          <Alert>
            {failures.length} plugin{failures.length === 1 ? '' : 's'} failed to load:{' '}
            {failures.map((f) => `${f.pluginId} (${f.reason})`).join('; ')}
          </Alert>
        </div>
      ) : null}
      <Routes>
        <Route element={<AppShell plugins={plugins} />}>
          <Route index element={<Dashboard plugins={plugins} contextFor={contextFor} />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="recurring" element={<RecurringPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {pluginRoutes(plugins, contextFor)}
          {/* Ranked below every plugin's own, more specific page route. */}
          <Route path="p/:pluginId/*" element={<PluginUnavailable />} />
          <Route path="*" element={<div className="page">Not found.</div>} />
        </Route>
      </Routes>
    </OnboardingProvider>
  )
}
