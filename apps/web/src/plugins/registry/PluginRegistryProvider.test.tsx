import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { PluginRegistry } from '../PluginRegistry.js'
import { PluginRegistryProvider } from './PluginRegistryProvider.js'
import { usePluginRegistry } from './usePluginRegistry.js'

const manifest = (id: string) => ({ id, name: id }) as unknown as PluginManifest
const registry = (...ids: string[]): PluginRegistry => ({ plugins: ids.map(manifest), failures: [] })

function Probe() {
  const { plugins, failures, refresh } = usePluginRegistry()
  return (
    <>
      <output aria-label="plugins">{plugins.map((p) => p.id).join(',')}</output>
      <output aria-label="failures">{failures.map((f) => f.reason).join(',')}</output>
      <button type="button" onClick={() => { void refresh() }}>refresh</button>
    </>
  )
}

const shown = (label: string) => screen.getByLabelText(label).textContent

describe('PluginRegistryProvider', () => {
  it('waits for the first load, then applies a refresh', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(registry('a.one', 'a.two'))
      .mockResolvedValueOnce(registry('a.one'))
    render(<PluginRegistryProvider load={load}><Probe /></PluginRegistryProvider>)
    expect(screen.getByRole('status', { name: 'Loading plugins' })).toBeTruthy()
    await waitFor(() => { expect(shown('plugins')).toBe('a.one,a.two') })

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => { expect(shown('plugins')).toBe('a.one') })
  })

  it('falls back to no plugins when the first load fails, so the core app still renders', async () => {
    const load = vi.fn().mockRejectedValue(new Error('down'))
    render(<PluginRegistryProvider load={load}><Probe /></PluginRegistryProvider>)
    await waitFor(() => { expect(shown('failures')).toBe('registry unavailable') })
    expect(shown('plugins')).toBe('')
  })

  it('keeps what it has when a later refresh fails', async () => {
    const load = vi.fn().mockResolvedValueOnce(registry('a.one')).mockRejectedValueOnce(new Error('down'))
    render(<PluginRegistryProvider load={load}><Probe /></PluginRegistryProvider>)
    await waitFor(() => { expect(shown('plugins')).toBe('a.one') })
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    expect(shown('plugins')).toBe('a.one')
    expect(shown('failures')).toBe('')
  })

  it('lets the latest refresh win when an earlier one resolves after it', async () => {
    let releaseSlow: (r: PluginRegistry) => void = () => {}
    const load = vi.fn()
      .mockResolvedValueOnce(registry('a.one'))
      .mockImplementationOnce(() => new Promise<PluginRegistry>((res) => { releaseSlow = res }))
      .mockResolvedValueOnce(registry('a.two'))
    render(<PluginRegistryProvider load={load}><Probe /></PluginRegistryProvider>)
    await waitFor(() => { expect(shown('plugins')).toBe('a.one') })

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => { expect(shown('plugins')).toBe('a.two') })
    await act(async () => { releaseSlow(registry('stale.one')) })
    expect(shown('plugins')).toBe('a.two')
  })

  it('refetches when the window regains focus, but not more often than the minimum interval', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const load = vi.fn().mockResolvedValueOnce(registry('a.one')).mockResolvedValue(registry())
    render(<PluginRegistryProvider load={load} minRefetchIntervalMs={30_000}><Probe /></PluginRegistryProvider>)
    await waitFor(() => { expect(shown('plugins')).toBe('a.one') })

    now.mockReturnValue(1_000_000 + 29_999)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(load).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1_000_000 + 30_000)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => { expect(shown('plugins')).toBe('') })
    expect(load).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })
})
