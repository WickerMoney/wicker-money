import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { connectToHost, type HostConnection } from '@wickermoney/plugin-sdk/isolated'
import { FrameApp } from './FrameApp.js'
import { parseFrameFragment, type FrameParams } from './fragment.js'
import { loadPluginComponent } from './loadModule.js'

/** Seams for tests; the defaults are the real thing. */
export interface MountDeps {
  readonly connect?: () => Promise<HostConnection>
  readonly load?: (params: FrameParams) => Promise<ComponentType<Record<string, unknown>>>
}

/** Shows a failure in the frame itself, as text only. */
function showError(root: HTMLElement, message: string): void {
  const p = root.ownerDocument.createElement('p')
  p.setAttribute('role', 'alert')
  p.textContent = message
  root.replaceChildren(p)
}

/**
 * Starts the frame: reads what to mount, connects to the host, loads the
 * plugin's module and renders it.
 *
 * Connecting comes first so a plugin that is slow or broken still gets the host
 * to show it as failed rather than a blank box, and the host's theme is applied
 * before anything draws.
 *
 * @param root - The element to render into.
 * @param hash - `location.hash`.
 * @param base - The document URL.
 * @param deps - Test seams.
 * @returns A function that unmounts and disconnects.
 */
export async function mountPlugin(
  root: HTMLElement, hash: string, base: string, deps: MountDeps = {},
): Promise<() => void> {
  const params = parseFrameFragment(hash, base)
  if ('error' in params) {
    showError(root, params.error)
    return () => {}
  }
  // Styling only (frame.css): a page paints the page background, a widget stays transparent over its card.
  root.ownerDocument.documentElement.setAttribute('data-wm-frame', params.kind)
  const connection = await (deps.connect ?? (() => connectToHost()))().catch((error: unknown) => {
    showError(root, error instanceof Error ? error.message : 'Could not connect to Wicker Money.')
    return null
  })
  if (connection === null) return () => {}
  try {
    const Plugin = await (deps.load ?? loadPluginComponent)(params)
    const reactRoot = createRoot(root)
    reactRoot.render(<StrictMode><FrameApp connection={connection} Plugin={Plugin} /></StrictMode>)
    return () => { reactRoot.unmount(); connection.dispose() }
  } catch (error) {
    showError(root, error instanceof Error ? error.message : 'The plugin could not be loaded.')
    return () => { connection.dispose() }
  }
}
