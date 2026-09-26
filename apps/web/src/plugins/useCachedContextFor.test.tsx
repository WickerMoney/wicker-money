import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'

vi.mock('./MountedWidget.js', () => ({
  MountedWidget: ({ ctx, manifest }: { ctx: PluginContext; manifest: PluginManifest }) => {
    seen.push({ id: manifest.id, ctx })
    return null
  },
}))

const seen: { id: string; ctx: PluginContext }[] = []
const { PluginSlot } = await import('./PluginSlot.js')

function manifest(id: string): PluginManifest {
  return {
    id, name: id,
    contributes: { pages: [], widgets: [{ id: 'w', slot: 'dashboard.main', order: 1, title: 'W', module: './W', defaultSize: 'md' }] },
  } as unknown as PluginManifest
}

describe('PluginSlot', () => {
  it('builds each plugin context once and reuses it when the parent re-renders', () => {
    seen.length = 0
    const a = manifest('a')
    const b = manifest('b')
    const plugins = [a, b]
    const contextFor = vi.fn((m: PluginManifest) => ({ marker: m.id }) as unknown as PluginContext)

    const view = render(<PluginSlot slot={'dashboard.main' as never} plugins={plugins} contextFor={contextFor} />)
    view.rerender(<PluginSlot slot={'dashboard.main' as never} plugins={plugins} contextFor={contextFor} />)
    view.rerender(<PluginSlot slot={'dashboard.main' as never} plugins={plugins} contextFor={contextFor} range={undefined} />)

    expect(contextFor).toHaveBeenCalledTimes(2)
    const ctxA = seen.filter((s) => s.id === 'a').map((s) => s.ctx)
    expect(ctxA.length).toBeGreaterThan(1)
    expect(new Set(ctxA).size).toBe(1)
  })

  it('builds fresh contexts when the factory itself changes', () => {
    seen.length = 0
    const plugins = [manifest('a')]
    const first = vi.fn((m: PluginManifest) => ({ marker: `${m.id}-1` }) as unknown as PluginContext)
    const second = vi.fn((m: PluginManifest) => ({ marker: `${m.id}-2` }) as unknown as PluginContext)

    const view = render(<PluginSlot slot={'dashboard.main' as never} plugins={plugins} contextFor={first} />)
    view.rerender(<PluginSlot slot={'dashboard.main' as never} plugins={plugins} contextFor={second} />)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(new Set(seen.map((s) => s.ctx)).size).toBe(2)
  })
})
