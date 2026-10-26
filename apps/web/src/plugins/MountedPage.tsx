import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import { useLocation, useParams } from 'react-router'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
import { Spinner } from '@wickermoney/ui-kit'
import { NotFound } from '../pages/NotFound.js'
import { ErrorBoundary } from '../shell/ErrorBoundary.js'
import { IsolatedPluginFrame } from './isolated/IsolatedPluginFrame.js'
import { framePathUnder } from './isolated/framePathUnder.js'
import { loadPluginModule } from './loader.js'
import { usePluginRuntime } from './usePluginRuntime.js'

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
  /** The page's route, for example `/p/wickermoney.forecast/forecast`. Needed to tell a frame the path under it. */
  readonly basePath: string
}

/**
 * Mounts one plugin page, in the page's realm or in a sandboxed frame (the registry decides).
 *
 * The route matches the page's address and everything under it (`<basePath>/*`). A frame is told the part
 * under the page ({@link framePathUnder}) and decides what it means; an in-realm page has no use for one, so
 * an address under it is "not found", as it was when the route was exact.
 */
export function MountedPage(props: MountedPageProps) {
  const runtime = usePluginRuntime(props.manifest.id)
  const { '*': rest = '' } = useParams()
  if (runtime === 'isolated') return <IsolatedPage {...props} />
  return rest === '' ? <InRealmPage {...props} /> : <NotFound />
}

function IsolatedPage({ manifest, module, title, ctx, basePath }: MountedPageProps) {
  const { pathname, search } = useLocation()
  return (
    <ErrorBoundary label={`${manifest.name} · ${title}`}>
      <IsolatedPluginFrame manifest={manifest} module={module} title={title} kind="page" ctx={ctx}
                           path={framePathUnder(basePath, pathname, search)} />
    </ErrorBoundary>
  )
}

/** Mounts one in-realm plugin page inside its own error and Suspense boundaries. */
function InRealmPage({ manifest, module, title, ctx }: MountedPageProps) {
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
