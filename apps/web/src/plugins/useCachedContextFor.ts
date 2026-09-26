import { useMemo } from 'react'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'

/**
 * Wraps a context factory so each plugin gets one context object, reused
 * across renders.
 *
 * A plugin widget treats `ctx` as a dependency of its data effects, so handing
 * it a fresh object on every parent render makes every widget refetch whenever
 * anything above it re-renders. The cache is keyed by plugin id and rebuilt only
 * when the factory itself changes (a different user, say).
 *
 * @param contextFor - Builds the context for one manifest.
 * @returns A function with the same signature that returns a stable object per manifest.
 */
export function useCachedContextFor(
  contextFor: (manifest: PluginManifest) => PluginContext,
): (manifest: PluginManifest) => PluginContext {
  return useMemo(() => {
    const cache = new Map<string, { manifest: PluginManifest; ctx: PluginContext }>()
    return (manifest: PluginManifest) => {
      const hit = cache.get(manifest.id)
      if (hit !== undefined && hit.manifest === manifest) return hit.ctx
      const ctx = contextFor(manifest)
      cache.set(manifest.id, { manifest, ctx })
      return ctx
    }
  }, [contextFor])
}
