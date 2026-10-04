import { Alert } from '@wickermoney/ui-kit'
import type { RegisteredPlugin } from '../../../models/index.js'
import { describeContributions } from '../helpers/describeContributions.js'
import { PluginStatus } from './PluginStatus.js'
import { PluginSwitch } from './PluginSwitch.js'

/** Props for {@link PluginCard}. */
export interface PluginCardProps {
  /** The plugin to describe. */
  readonly plugin: RegisteredPlugin
  /** Whether to show where the plugin came from; only the owner listing knows. */
  readonly showOrigin: boolean
  /** The switch handler, or `undefined` for a read-only card. */
  readonly onToggle?: (next: boolean) => void
  /** True while this plugin's change is being saved. */
  readonly saving?: boolean
  /** The last failed change for this plugin, if any. */
  readonly error?: string | null
}

/** One plugin in the Plugins section: what it is, what it adds, its status and, for an owner, its switch. */
export function PluginCard({ plugin, showOrigin, onToggle, saving = false, error = null }: PluginCardProps) {
  const adds = describeContributions(plugin.contributes)
  return (
    <li className={`plugin-card${plugin.enabled ? '' : ' is-off'}`} aria-label={plugin.name}>
      <div className="plugin-card__main">
        <div className="plugin-card__head">
          <span className="plugin-card__name">{plugin.name}</span>
          <span className="plugin-card__version">v{plugin.version}</span>
          {showOrigin && plugin.bundled ? <span className="tag">bundled</span> : null}
          <PluginStatus status={plugin.status} />
        </div>
        {plugin.description !== null ? <p className="plugin-card__desc">{plugin.description}</p> : null}
        {adds !== null ? <p className="plugin-card__adds">Adds: {adds}</p> : null}
        {plugin.failure !== null ? (
          <p className="plugin-card__failure">
            {plugin.status === 'failed' ? 'Could not load: ' : 'Would not load: '}{plugin.failure}
          </p>
        ) : null}
        {error !== null ? <Alert>{error}</Alert> : null}
      </div>
      {onToggle !== undefined ? (
        <PluginSwitch name={plugin.name} on={plugin.enabled} saving={saving} onChange={onToggle} />
      ) : null}
    </li>
  )
}
