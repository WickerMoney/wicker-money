import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
import { Spinner } from '@wickermoney/ui-kit'
import { ErrorBoundary } from '../shell/ErrorBoundary.js'
import { loadPluginModule } from './loader.js'

/** Props for {@link MountedPage}. */
export interface MountedPageProps {
  /** The contributing plugin's manifest. */
  readonly manifest: PluginManifest
  /** The exposed module key from the manifest, for example `./BudgetsPage`. */
  readonly module: string
  /** Page title, used as the loading and error label. */
  readonly title: string
  /** The context handed to the page. */
  readonly ctx: PluginContext
}

/** Mounts one plugin page inside its own error and Suspense boundaries. */
export function MountedPage({ manifest, module, title, ctx }: MountedPageProps) {
  const Page = useMemo(
    () => lazy(async () => ({
      default: await loadPluginModule<ComponentType<{ ctx: PluginContext }>>(manifest.id, module),
    })),
    [manifest.id, module],
  )
  return (
    <ErrorBoundary label={`${manifest.name} · ${title}`}>
      <Suspense fallback={<Spinner label={`Loading ${title}`} />}>
        <Page ctx={ctx} />
      </Suspense>
    </ErrorBoundary>
  )
}
