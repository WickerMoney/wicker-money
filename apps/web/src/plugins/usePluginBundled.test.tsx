import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { PluginRegistryCtx } from './registry/pluginRegistryContext.js'
import type { PluginRegistryState } from './registry/PluginRegistryState.js'
import { usePluginBundled } from './usePluginBundled.js'

const wrap = (state: Partial<PluginRegistryState> | null) =>
  ({ children }: { children: ReactNode }) => (
    <PluginRegistryCtx.Provider value={state === null ? null : { plugins: [], failures: [], refresh: async () => {}, ...state }}>
      {children}
    </PluginRegistryCtx.Provider>
  )

describe('usePluginBundled', () => {
  it('is true only for an explicit true in the registry map', () => {
    const w = wrap({ bundled: { 'a.yes': true, 'a.no': false } })
    expect(renderHook(() => usePluginBundled('a.yes'), { wrapper: w }).result.current).toBe(true)
    expect(renderHook(() => usePluginBundled('a.no'), { wrapper: w }).result.current).toBe(false)
    expect(renderHook(() => usePluginBundled('a.unknown'), { wrapper: w }).result.current).toBe(false)
  })

  it('is false without a provider and without a bundled map', () => {
    expect(renderHook(() => usePluginBundled('a.yes')).result.current).toBe(false)
    expect(renderHook(() => usePluginBundled('a.yes'), { wrapper: wrap(null) }).result.current).toBe(false)
    expect(renderHook(() => usePluginBundled('a.yes'), { wrapper: wrap({}) }).result.current).toBe(false)
  })
})
