import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState, Spinner, Surface } from '@wickermoney/ui-kit'
import { useAuth } from '../auth/index.js'
import { PLUGIN_SETTINGS_PATH } from './admin/PLUGIN_SETTINGS_PATH.js'
import { useRegisteredPlugins } from './admin/useRegisteredPlugins.js'
import { usePluginRegistry } from './registry/usePluginRegistry.js'

/**
 * Shown at a plugin page's address when no enabled plugin serves it: the
 * plugin was switched off (perhaps while the page was open), failed to load,
 * or is not installed.
 *
 * Plugin pages live under `/p/<pluginId>/`, so the plugin is known from the
 * address even though its routes are gone. An owner is told which plugin it
 * is and offered the plugin settings; a member is told who can turn it back
 * on. Either way it says the plugin's data is kept, because disabling never
 * removes any.
 */
export function PluginUnavailable() {
  const { pluginId = '' } = useParams()
  const { failures, refresh } = usePluginRegistry()
  const isOwner = useAuth().user?.role === 'owner'
  const registered = useRegisteredPlugins(isOwner)

  // This page may be showing because this tab's registry is older than the
  // server's (another owner just switched the plugin on). One refetch settles
  // it: if the plugin is back, its real route replaces this one.
  useEffect(() => { void refresh() }, [refresh])

  if (registered.kind === 'loading') {
    return <div className="page"><Spinner label="Checking plugin" /></div>
  }

  const known = registered.kind === 'loaded' ? registered.plugins.find((p) => p.id === pluginId) : undefined
  const loadFailure = failures.find((f) => f.pluginId === pluginId)
  const name = known?.name ?? 'This plugin'

  let title: string
  let hint: string
  if (registered.kind === 'loaded' && known === undefined) {
    title = 'This plugin is not installed'
    hint = `Nothing on this Wicker Money instance is registered as ${pluginId}.`
  } else if (known?.status === 'failed' || loadFailure !== undefined) {
    title = `${name} could not be loaded`
    hint = known?.failure ?? loadFailure?.reason ?? 'It is switched on but did not load.'
  } else {
    title = `${name} is turned off`
    hint = isOwner
      ? 'Its data is kept. Turn it back on in Settings to use this page again.'
      : 'Its data is kept. An owner of this Wicker Money instance can turn it back on in Settings.'
  }

  return (
    <div className="page">
      <Surface>
        <div className="plugin-off" role="status">
          <EmptyState
            title={title}
            hint={hint}
            action={isOwner ? (
              <Link className="wm-btn wm-btn--primary" to={PLUGIN_SETTINGS_PATH}>Manage plugins</Link>
            ) : (
              <Link className="wm-btn" to="/">Go to the dashboard</Link>
            )}
          />
        </div>
      </Surface>
    </div>
  )
}
