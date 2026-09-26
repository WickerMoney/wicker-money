import { useCallback, useEffect, useRef, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { Alert, Spinner } from '@wickermoney/ui-kit'
import { useAuth } from './auth/index.js'
import { SetupWizard, OnboardingProvider } from './onboarding/index.js'
import { AccountsPage } from './pages/Accounts/index.js'
import { CategoriesPage } from './pages/Categories/index.js'
import { Dashboard } from './pages/Dashboard/index.js'
import { SettingsPage } from './pages/Settings/index.js'
import { TransactionsPage } from './pages/Transactions/index.js'
import { buildPluginContext } from './plugins/context.js'
import { loadPluginRegistry } from './plugins/loader.js'
import type { PluginLoadFailure } from './plugins/PluginLoadFailure.js'
import { pluginRoutes } from './plugins/PluginRoutes.js'
import { useCachedContextFor } from './plugins/useCachedContextFor.js'
import { AppShell } from './shell/AppShell.js'

/**
 * The signed-in application: loads the plugin registry, then renders the shell
 * and every core and plugin route.
 *
 * Must be rendered inside a router and an `AuthProvider`, with a signed-in user.
 */
export function AuthenticatedApp() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [plugins, setPlugins] = useState<readonly PluginManifest[] | null>(null)
  const [failures, setFailures] = useState<readonly PluginLoadFailure[]>([])

  useEffect(() => {
    let live = true
    loadPluginRegistry()
      .then((registry) => {
        if (!live) return
        setPlugins(registry.plugins)
        setFailures(registry.failures)
      })
      .catch(() => {
        // The registry failing must not stop the core app: the ledger works
        // with no plugins at all, and that is the point of a thin core.
        if (live) { setPlugins([]); setFailures([{ pluginId: '*', reason: 'registry unavailable' }]) }
      })
    return () => { live = false }
  }, [])

  // `navigate` changes identity with the location; reading it through a ref
  // keeps every plugin context stable across in-app navigation.
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  const buildContext = useCallback(
    (manifest: PluginManifest) => buildPluginContext(manifest, user!, (p) => navigateRef.current(p)),
    [user],
  )
  const contextFor = useCachedContextFor(buildContext)

  if (plugins === null) return <div className="boot"><Spinner label="Loading plugins" /></div>

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
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {pluginRoutes(plugins, contextFor)}
          <Route path="*" element={<div className="page">Not found.</div>} />
        </Route>
      </Routes>
    </OnboardingProvider>
  )
}
