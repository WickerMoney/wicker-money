import { useMemo, useState } from 'react'
import {
  resolveRange, type PluginContext, type PluginManifest, type RangeKey,
} from '@wickermoney/plugin-sdk'
import { EmptyState, Surface } from '@wickermoney/ui-kit'
import { useAuth } from '../../auth/index.js'
import { PluginSlot } from '../../plugins/PluginSlot.js'
import { RangeSelector } from './components/RangeSelector.js'
import { rememberRange, storedRange } from './helpers/rangeStorage.js'
import { todayIn } from './helpers/todayIn.js'

/** Props for {@link Dashboard}. */
export interface DashboardProps {
  /** Loaded plugins whose widgets fill the dashboard slots. */
  readonly plugins: readonly PluginManifest[]
  /** Builds the context handed to a plugin's widgets. */
  readonly contextFor: (manifest: PluginManifest) => PluginContext
}

/**
 * The dashboard: a host for plugin widgets, not a page of charts.
 *
 * Core contributes no widgets of its own; everything shown arrives from an
 * installed plugin. If the dashboard could query plugin tables directly, the
 * core would grow back into a monolith.
 *
 * What core does own is the time range. There is one control for the whole
 * dashboard rather than one per widget, because two charts side by side showing
 * different periods while looking comparable is the specific way a dashboard
 * misleads. The range is resolved here and passed down as a prop; widgets read
 * it and never publish to it, so none of them can observe or affect another.
 */
export function Dashboard({ plugins, contextFor }: DashboardProps) {
  const { user } = useAuth()
  const [rangeKey, setRangeKey] = useState<RangeKey>(storedRange)

  const range = useMemo(
    // Where one month ends and the next begins depends on where the user is,
    // not on where the server is.
    () => resolveRange(rangeKey, todayIn(user?.timezone ?? 'UTC')),
    [rangeKey, user],
  )

  const choose = (key: RangeKey): void => {
    setRangeKey(key)
    rememberRange(key)
  }

  const widgetCount = plugins.reduce((n, p) => n + p.contributes.widgets.length, 0)

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Dashboard</h1>
        {widgetCount > 0 ? <RangeSelector value={rangeKey} onChange={choose} /> : null}
      </div>

      {widgetCount === 0 ? (
        <Surface>
          <EmptyState
            title="No widgets installed"
            hint="Enable a plugin that contributes dashboard widgets to fill this space."
          />
        </Surface>
      ) : (
        <>
          <div className="slot slot--primary">
            <PluginSlot
              slot="dashboard.primary" plugins={plugins} contextFor={contextFor} range={range}
            />
          </div>
          <div className="slot slot--secondary">
            <PluginSlot
              slot="dashboard.secondary" plugins={plugins} contextFor={contextFor} range={range}
            />
          </div>
        </>
      )}
    </div>
  )
}
