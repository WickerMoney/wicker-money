import { act, renderHook, waitFor } from '@testing-library/react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import { useImportFlow } from './useImportFlow.js'

const CSV = [
  'Date,Description,Amount',
  '03/04/2026,COFFEE BAR,-4.50',
  '03/05/2026,PAYCHECK,2500.00',
].join('\n')

function fakeContext(): PluginContext {
  const get = vi.fn(async (path: string) => (path.endsWith('/mappings') ? { mappings: [] } : { accounts: [] }))
  return { api: { get, post: vi.fn() } } as unknown as PluginContext
}

async function loadedFlow() {
  const ctx = fakeContext()
  const hook = renderHook(() => useImportFlow(ctx))
  await act(async () => {
    await hook.result.current.onFile(new File([CSV], 'march.csv', { type: 'text/csv' }))
  })
  await waitFor(() => expect(hook.result.current.preview).not.toBeNull())
  return hook
}

describe('useImportFlow preview', () => {
  it('maps the file once it is chosen and columns are suggested', async () => {
    const { result } = await loadedFlow()
    expect(result.current.headers).toEqual(['Date', 'Description', 'Amount'])
    expect(result.current.preview?.rows).toHaveLength(2)
  })

  it('does not re-map the file while the source name is typed', async () => {
    const { result } = await loadedFlow()
    const before = result.current.preview

    for (const name of ['C', 'Ch', 'Cha', 'Chase']) {
      act(() => result.current.setSourceName(name))
    }

    expect(result.current.sourceName).toBe('Chase')
    expect(result.current.preview).toBe(before)
  })

  it('re-maps when a setting that changes the result changes', async () => {
    const { result } = await loadedFlow()
    const before = result.current.preview

    act(() => result.current.setDateFormat('DD/MM/YYYY'))

    expect(result.current.preview).not.toBe(before)
    expect(result.current.preview?.rows[0]?.date).toBe('2026-04-03')
  })

  it('keeps the same header list across unrelated renders', async () => {
    const { result } = await loadedFlow()
    const before = result.current.headers
    act(() => result.current.setInvertAmount(true))
    expect(result.current.headers).toBe(before)
  })

  it('clears the parsed file on reset', async () => {
    const { result } = await loadedFlow()
    act(() => result.current.reset())
    expect(result.current.headers).toEqual([])
    expect(result.current.preview).toBeNull()
  })
})

type Body = Record<string, unknown>

/** A context whose `post` records commit bodies and fails them as told. */
function commitContext(failures: number) {
  let remaining = failures
  const commits: Body[] = []
  const post = vi.fn(async (path: string, body: Body) => {
    if (path.endsWith('/analyze')) return { summary: {}, errors: [], rows: [] }
    if (path.endsWith('/commit')) {
      commits.push(body)
      if (remaining > 0) {
        remaining -= 1
        throw new Error('network down')
      }
      return { imported: 2, skipped: 0, flagged: 0, failed: 0 }
    }
    return {}
  })
  const get = vi.fn(async (path: string) => (path.endsWith('/mappings') ? { mappings: [] } : { accounts: [] }))
  return { ctx: { api: { get, post } } as unknown as PluginContext, commits }
}

async function reviewedFlow(ctx: PluginContext) {
  const hook = renderHook(() => useImportFlow(ctx))
  const pick = async () => {
    await act(async () => {
      await hook.result.current.onFile(new File([CSV], 'march.csv', { type: 'text/csv' }))
    })
    await waitFor(() => expect(hook.result.current.preview).not.toBeNull())
    await act(async () => {
      await hook.result.current.analyze()
    })
  }
  await pick()
  return { ...hook, pick }
}

describe('useImportFlow commit idempotency key', () => {
  it('sends a UUID key with the commit', async () => {
    const { ctx, commits } = commitContext(0)
    const { result } = await reviewedFlow(ctx)
    await act(async () => {
      await result.current.commit()
    })
    expect(commits).toHaveLength(1)
    expect(commits[0]?.['idempotencyKey']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('reuses the same key when the user retries after a network error', async () => {
    const { ctx, commits } = commitContext(1)
    const { result } = await reviewedFlow(ctx)
    await act(async () => {
      await result.current.commit()
    })
    expect(result.current.error).toBe('network down')
    await act(async () => {
      await result.current.commit()
    })
    expect(commits).toHaveLength(2)
    expect(commits[1]?.['idempotencyKey']).toBe(commits[0]?.['idempotencyKey'])
    expect(result.current.stage).toBe('done')
  })

  it('sends one key for two commits started before either finishes', async () => {
    const { ctx, commits } = commitContext(0)
    const { result } = await reviewedFlow(ctx)
    await act(async () => {
      await Promise.all([result.current.commit(), result.current.commit()])
    })
    expect(commits).toHaveLength(2)
    expect(commits[1]?.['idempotencyKey']).toBe(commits[0]?.['idempotencyKey'])
  })

  it('uses a new key for a new import, after a reset or a new file', async () => {
    const { ctx, commits } = commitContext(0)
    const { result, pick } = await reviewedFlow(ctx)
    await act(async () => {
      await result.current.commit()
    })
    act(() => result.current.reset())
    await pick()
    await act(async () => {
      await result.current.commit()
    })
    await pick()
    await act(async () => {
      await result.current.commit()
    })
    const keys = commits.map((c) => c['idempotencyKey'])
    expect(new Set(keys).size).toBe(3)
  })

  it('uses a new key when the same file is analysed again', async () => {
    const { ctx, commits } = commitContext(1)
    const { result } = await reviewedFlow(ctx)
    await act(async () => {
      await result.current.commit()
    })
    await act(async () => {
      await result.current.analyze()
    })
    await act(async () => {
      await result.current.commit()
    })
    expect(commits[1]?.['idempotencyKey']).not.toBe(commits[0]?.['idempotencyKey'])
  })
})
