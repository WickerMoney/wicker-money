import { useCallback, useEffect, useRef } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { Alert } from '@wickermoney/ui-kit'
import { useAuth } from './auth/index.js'
import { SetupWizard, OnboardingProvider } from './onboarding/index.js'
import { LazyAccountsPage } from './pages/LazyAccountsPage.js'
import { LazyCategoriesPage } from './pages/LazyCategoriesPage.js'
import { Dashboard } from './pages/Dashboard/index.js'
import { LazySettingsPage } from './pages/LazySettingsPage.js'
import { LazyTransactionsPage } from './pages/LazyTransactionsPage.js'
import { LazyRecurringPage } from './pages/LazyRecurringPage.js'
import { buildPluginContext } from './plugins/context.js'
import { PluginUnavailable } from './plugins/PluginUnavailable.js'
import { pluginRoutes } from './plugins/PluginRoutes.js'
import { usePluginRegistry } from './plugins/registry/index.js'
import { useCachedContextFor } from './plugins/useCachedContextFor.js'
import { AppShell } from './shell/AppShell.js'
import { PageBoundary } from './shell/PageBoundary.js'
import { NotFound } from './pages/NotFound.js'

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
 * The Dashboard is the landing page and stays in the entry chunk; every other
 * core page is a separate chunk fetched on first visit (see {@link PageBoundary}).
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
          <Route path="accounts" element={<PageBoundary label="Accounts"><LazyAccountsPage /></PageBoundary>} />
          <Route path="transactions" element={<PageBoundary label="Transactions"><LazyTransactionsPage /></PageBoundary>} />
          <Route path="recurring" element={<PageBoundary label="Recurring"><LazyRecurringPage /></PageBoundary>} />
          <Route path="categories" element={<PageBoundary label="Categories"><LazyCategoriesPage /></PageBoundary>} />
          <Route path="settings" element={<PageBoundary label="Settings"><LazySettingsPage /></PageBoundary>} />
          {pluginRoutes(plugins, contextFor)}
          {/* Ranked below every plugin's own, more specific page route. */}
          <Route path="p/:pluginId/*" element={<PluginUnavailable />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </OnboardingProvider>
  )
}
