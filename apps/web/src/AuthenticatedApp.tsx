import { PluginRegistryProvider } from './plugins/registry/index.js'
import { AuthenticatedRoutes } from './AuthenticatedRoutes.js'

/**
 * The signed-in application: loads the plugin registry, then renders the shell
 * and every core and plugin route. The registry stays live, so switching a
 * plugin on or off applies without a page reload.
 *
 * Must be rendered inside a router and an `AuthProvider`, with a signed-in user.
 */
export function AuthenticatedApp() {
  return (
    <PluginRegistryProvider>
      <AuthenticatedRoutes />
    </PluginRegistryProvider>
  )
}
