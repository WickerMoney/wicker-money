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

const ACCOUNTS = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Checking' }]

/** A context whose `post` records commit bodies and fails them as told. */
function commitContext(failures: number) {
  let remaining = failures
  const commits: Body[] = []
  const post = vi.fn(async (path: string, body: Body) => {
    if (path.endsWith('/analyze')) return { summary: {}, errors: [], rows: [], flagged: { total: 0, offset: 0, rows: [] } }
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
  const get = vi.fn(async (path: string) => (path.endsWith('/mappings') ? { mappings: [] } : { accounts: ACCOUNTS }))
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
    expect(result.current.errors.form).toBe('network down')
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

describe('useImportFlow errors', () => {
  it('refuses a source name the server would refuse, on that field, without sending', async () => {
    const { ctx } = commitContext(0)
    const { result } = renderHook(() => useImportFlow(ctx))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(new File([CSV], 'march.csv', { type: 'text/csv' })) })
    act(() => result.current.setSourceName('x'.repeat(121)))

    await act(async () => { await result.current.analyze() })

    expect(result.current.errors.fields).toEqual({ sourceName: 'Must be 120 characters or fewer.' })
    expect(ctx.api.post).not.toHaveBeenCalled()
  })

  it("puts the server's refusal on the control it names", async () => {
    const { ctx } = commitContext(0)
    vi.mocked(ctx.api.post).mockRejectedValueOnce(Object.assign(new Error('columns.merchant: Choose the description column.'), {
      issues: [{ path: ['columns', 'merchant'], message: 'Choose the description column.' }],
    }))
    const { result } = renderHook(() => useImportFlow(ctx))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(new File([CSV], 'march.csv', { type: 'text/csv' })) })

    await act(async () => { await result.current.analyze() })

    expect(result.current.errors).toEqual({ fields: { 'columns.merchant': 'Choose the description column.' }, form: null })
  })

  it('names a file with no header row under the file input', async () => {
    const { ctx } = commitContext(0)
    const { result } = renderHook(() => useImportFlow(ctx))

    await act(async () => { await result.current.onFile(new File([''], 'empty.csv', { type: 'text/csv' })) })

    expect(result.current.errors.fields['csv']).toMatch(/no header row/)
    expect(result.current.error).toBeNull()
  })
})

describe('useImportFlow loadMoreFlagged', () => {
  const row = (n: number) => ({
    rowNumber: n, date: '2026-03-04', merchant: `SHOP ${n}`, amount: '-1.00', notes: null, externalId: null,
    status: 'needs-review', reason: 'looks like SHOP', matched: null,
  })

  /** A server that has 5 flagged rows and sends them 2 at a time. */
  function pagedContext() {
    const analyses: Body[] = []
    const post = vi.fn(async (path: string, body: Body) => {
      if (!path.endsWith('/analyze')) return {}
      analyses.push(body)
      const offset = typeof body['flaggedOffset'] === 'number' ? body['flaggedOffset'] : 0
      const page = [2, 3, 4, 5, 6].slice(offset, offset + 2).map(row)
      return {
        summary: { total: 5, new: 0, duplicate: 0, needsReview: 5, errors: 0 },
        errors: [], rows: page, flagged: { total: 5, offset, rows: page },
      }
    })
    const get = vi.fn(async (path: string) => (path.endsWith('/mappings') ? { mappings: [] } : { accounts: ACCOUNTS }))
    return { ctx: { api: { get, post } } as unknown as PluginContext, analyses }
  }

  it('asks for the page after the rows it has, with the file it analysed, and appends the answer', async () => {
    const { ctx, analyses } = pagedContext()
    const { result } = await reviewedFlow(ctx)
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3])

    await act(async () => { expect(await result.current.loadMoreFlagged()).toBe(true) })
    expect(analyses[1]?.['flaggedOffset']).toBe(2)
    expect(analyses[1]?.['csv']).toBe(analyses[0]?.['csv'])
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5])

    await act(async () => { await result.current.loadMoreFlagged() })
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5, 6])
  })

  it('lists a row once even when two pages overlap', async () => {
    const { ctx } = pagedContext()
    const { result } = await reviewedFlow(ctx)
    vi.mocked(ctx.api.post).mockResolvedValueOnce({
      summary: {}, errors: [], rows: [],
      flagged: { total: 5, offset: 2, rows: [row(3), row(4)] },
    })
    await act(async () => { await result.current.loadMoreFlagged() })
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4])
  })

  it('keeps the rows it has and reports the failure when the page cannot be loaded', async () => {
    const { ctx } = pagedContext()
    const { result } = await reviewedFlow(ctx)
    vi.mocked(ctx.api.post).mockRejectedValueOnce(new Error('network down'))
    await act(async () => { expect(await result.current.loadMoreFlagged()).toBe(false) })
    expect(result.current.errors.form).toBe('network down')
    expect(result.current.analysis?.flagged.rows).toHaveLength(2)
  })

  it('does nothing before there is an analysis', async () => {
    const { ctx } = pagedContext()
    const { result } = renderHook(() => useImportFlow(ctx))
    await act(async () => { expect(await result.current.loadMoreFlagged()).toBe(false) })
    expect(ctx.api.post).not.toHaveBeenCalled()
  })
})
