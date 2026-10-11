import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import type {
  DashboardRange, PluginContext, PluginManifest, WidgetContribution,
} from '@wickermoney/plugin-sdk'
import { Spinner, Surface } from '@wickermoney/ui-kit'
import { ErrorBoundary } from '../shell/ErrorBoundary.js'
import { IsolatedPluginFrame } from './isolated/IsolatedPluginFrame.js'
import { loadPluginModule } from './loader.js'
import { usePluginRuntime } from './usePluginRuntime.js'

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
 * Mounts one plugin widget, in the page or in a sandboxed frame.
 *
 * Which one is the registry's call ({@link usePluginRuntime}), not the
 * plugin's. Both live in the same card, so the grid cannot tell them apart.
 */
export function MountedWidget(props: MountedWidgetProps) {
  const runtime = usePluginRuntime(props.manifest.id)
  return runtime === 'isolated' ? <IsolatedWidget {...props} /> : <InRealmWidget {...props} />
}

/** An isolated widget: one frame per widget (see ADR 0005 and the 0.6.0 plan for why). */
function IsolatedWidget({ manifest, contribution, ctx, range }: MountedWidgetProps) {
  const label = `${manifest.name} · ${contribution.title}`
  return (
    <div className={`slot-item slot-item--${contribution.defaultSize}`}>
      <Surface title={contribution.title}>
        <ErrorBoundary label={label}>
          <IsolatedPluginFrame
            manifest={manifest} module={contribution.module} title={contribution.title}
            kind="widget" ctx={ctx} size={contribution.defaultSize} range={range}
          />
        </ErrorBoundary>
      </Surface>
    </div>
  )
}

/**
 * Mounts one in-realm plugin widget.
 *
 * Wrapped in its own error boundary and its own Suspense boundary: a widget that
 * fails to load and a widget that throws while rendering are different failures,
 * and neither should take out its neighbour.
 */
function InRealmWidget({ manifest, contribution, ctx, range }: MountedWidgetProps) {
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
