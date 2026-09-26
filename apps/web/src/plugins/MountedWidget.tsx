import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import type {
  DashboardRange, PluginContext, PluginManifest, WidgetContribution,
} from '@wickermoney/plugin-sdk'
import { Spinner, Surface } from '@wickermoney/ui-kit'
import { ErrorBoundary } from '../shell/ErrorBoundary.js'
import { loadPluginModule } from './loader.js'

/** Props for {@link MountedWidget}. */
export interface MountedWidgetProps {
  /** The contributing plugin's manifest. */
  readonly manifest: PluginManifest
  /** The widget entry from that manifest. */
  readonly contribution: WidgetContribution
  /** The context handed to the widget. */
  readonly ctx: PluginContext
  /** The dashboard range the widget should honour, if the host provides one. */
  readonly range?: DashboardRange
}

/**
 * Mounts one plugin widget.
 *
 * Wrapped in its own error boundary and its own Suspense boundary: a widget that
 * fails to load and a widget that throws while rendering are different failures,
 * and neither should take out its neighbour.
 */
export function MountedWidget({ manifest, contribution, ctx, range }: MountedWidgetProps) {
  const Widget = useMemo(
    () =>
      lazy(async () => {
        const component = await loadPluginModule<
          ComponentType<{ ctx: PluginContext; size: string; range?: DashboardRange }>
        >(
          manifest.id,
          contribution.module,
        )
        return { default: component }
      }),
    [manifest.id, contribution.module],
  )

  const label = `${manifest.name} · ${contribution.title}`
  return (
    <div className={`slot-item slot-item--${contribution.defaultSize}`}>
      <Surface title={contribution.title}>
        <ErrorBoundary label={label}>
          <Suspense fallback={<Spinner label={`Loading ${contribution.title}`} />}>
            <Widget ctx={ctx} size={contribution.defaultSize} range={range} />
          </Suspense>
        </ErrorBoundary>
      </Surface>
    </div>
  )
}
