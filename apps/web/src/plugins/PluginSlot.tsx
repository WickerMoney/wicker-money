import type {
  DashboardRange, PluginContext, PluginManifest, WidgetSlot,
} from '@wickermoney/plugin-sdk'
import { MountedWidget } from './MountedWidget.js'
import { useCachedContextFor } from './useCachedContextFor.js'

/** Props for {@link PluginSlot}. */
export interface PluginSlotProps {
  /** Which dashboard slot to fill. */
  readonly slot: WidgetSlot
  /** Loaded plugins to draw contributions from. */
  readonly plugins: readonly PluginManifest[]
  /** Builds the context handed to a plugin's widgets. */
  readonly contextFor: (manifest: PluginManifest) => PluginContext
  /**
   * Handed to every widget in the slot, unchanged.
   *
   * The host owns the control and the widgets read it. Nothing subscribes, so no
   * widget can observe or affect another.
   */
  readonly range?: DashboardRange
  /** Rendered when no installed plugin contributes to the slot. */
  readonly empty?: React.ReactNode
}

/**
 * Renders every widget contributed to one slot.
 *
 * The host does not know what will appear here: the list comes from installed
 * manifests. Core owns the grid; plugins own what fills it.
 */
export function PluginSlot({ slot, plugins, contextFor, range, empty }: PluginSlotProps) {
  const contextOf = useCachedContextFor(contextFor)
  const entries = plugins
    .flatMap((manifest) =>
      manifest.contributes.widgets
        .filter((w) => w.slot === slot)
        .map((contribution) => ({ manifest, contribution })),
    )
    .sort((a, b) => a.contribution.order - b.contribution.order)

  if (entries.length === 0) return <>{empty}</>

  return (
    <>
      {entries.map(({ manifest, contribution }) => (
        <MountedWidget
          key={`${manifest.id}:${contribution.id}`}
          manifest={manifest}
          contribution={contribution}
          ctx={contextOf(manifest)}
          range={range}
        />
      ))}
    </>
  )
}
