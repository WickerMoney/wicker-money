import { act, renderHook, waitFor } from '@testing-library/react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import { describe, expect, it } from 'vitest'
import type { ImportAccount } from '../models/index.js'
import { failure, fakeImportApi } from '../testing/fakeImportApi.js'
import { useImportFlow } from './useImportFlow.js'

const CSV = [
  'Date,Description,Amount',
  '03/04/2026,COFFEE BAR,-4.50',
  '03/05/2026,PAYCHECK,2500.00',
].join('\n')

const ctxOf = (server: ReturnType<typeof fakeImportApi>): PluginContext => ({ api: server.api }) as unknown as PluginContext
/** A hook callback over one context: a new context on every render would reload the page's data on every render. */
const useFlowOf = (server: ReturnType<typeof fakeImportApi>) => {
  const ctx = ctxOf(server)
  return () => useImportFlow(ctx)
}
const file = (text = CSV, name = 'march.csv'): File => new File([text], name, { type: 'text/csv' })

async function loadedFlow() {
  const ctx = ctxOf(fakeImportApi())
  const hook = renderHook(() => useImportFlow(ctx))
  await act(async () => {
    await hook.result.current.onFile(file())
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

const ACCOUNTS = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Checking' }] as unknown as ImportAccount[]

/** A server whose commits fail as told (a number of times, with this message). */
function commitContext(failures: number, message = 'network down') {
  const server = fakeImportApi({ accounts: ACCOUNTS })
  server.intercept('/commit', (_call, nth) => {
    if (nth <= failures) throw new Error(message)
  })
  return { server, ctx: ctxOf(server), commits: () => server.callsTo('/commit').map((c) => c.body) }
}

async function reviewedFlow(ctx: PluginContext) {
  const hook = renderHook(() => useImportFlow(ctx))
  const pick = async () => {
    await act(async () => {
      await hook.result.current.onFile(file())
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
    expect(commits()).toHaveLength(1)
    expect(commits()[0]?.['idempotencyKey']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
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
    expect(commits()).toHaveLength(2)
    expect(commits()[1]?.['idempotencyKey']).toBe(commits()[0]?.['idempotencyKey'])
    // A failed commit leaves the staged file in place: the retry names the same upload.
    expect(commits()[1]?.['uploadId']).toBe(commits()[0]?.['uploadId'])
    expect(result.current.stage).toBe('done')
  })

  it('sends one key for two commits started before either finishes', async () => {
    const { ctx, commits } = commitContext(0)
    const { result } = await reviewedFlow(ctx)
    await act(async () => {
      await Promise.all([result.current.commit(), result.current.commit()])
    })
    expect(commits()).toHaveLength(2)
    expect(commits()[1]?.['idempotencyKey']).toBe(commits()[0]?.['idempotencyKey'])
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
    const keys = commits().map((c) => c['idempotencyKey'])
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
    expect(commits()[1]?.['idempotencyKey']).not.toBe(commits()[0]?.['idempotencyKey'])
  })

  it('answers a commit whose reply was lost from the first one, with the same key and the same upload', async () => {
    const { server, ctx, commits } = commitContext(0)
    const { result } = await reviewedFlow(ctx)
    const real = server.post.getMockImplementation()!
    let lost = false
    server.post.mockImplementation(async (path, body, init) => {
      const r = await real(path, body, init)
      // The first commit reached the server and imported; its answer never reached the page.
      if (path.endsWith('/commit') && !lost) {
        lost = true
        throw failure(0, 'network_error', 'Could not reach Wicker Money.')
      }
      return r
    })
    await act(async () => {
      await result.current.commit()
    })
    expect(result.current.errors.form).toBe('Could not reach Wicker Money.')
    expect(result.current.stage).toBe('review')

    await act(async () => {
      await result.current.commit()
    })

    expect(commits()).toHaveLength(2)
    expect(commits()[1]?.['uploadId']).toBe(commits()[0]?.['uploadId'])
    expect(commits()[1]?.['idempotencyKey']).toBe(commits()[0]?.['idempotencyKey'])
    expect(result.current.result).toMatchObject({ imported: 2, replayed: true })
    expect(result.current.stage).toBe('done')
  })
})

describe('useImportFlow errors', () => {
  it('refuses a source name the server would refuse, on that field, without asking the server to analyse', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(file()) })
    act(() => result.current.setSourceName('x'.repeat(121)))

    await act(async () => { await result.current.analyze() })

    expect(result.current.errors.fields).toEqual({ sourceName: 'Must be 120 characters or fewer.' })
    expect(server.callsTo('/analyze')).toHaveLength(0)
  })

  it("puts the server's refusal on the control it names", async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    server.intercept('/analyze', () => {
      throw Object.assign(new Error('columns.merchant: Choose the description column.'), {
        issues: [{ path: ['columns', 'merchant'], message: 'Choose the description column.' }],
      })
    })
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(file()) })

    await act(async () => { await result.current.analyze() })

    expect(result.current.errors).toEqual({ fields: { 'columns.merchant': 'Choose the description column.' }, form: null })
  })

  it('shows the server\'s "other imports are running" sentence by the button, keeps the review, and retries with the same key', async () => {
    const busy = 'Other imports are still running and yours has not started after 30 seconds. Nothing was imported. Try again in about 30 seconds.'
    const { ctx, commits } = commitContext(1, busy)
    const { result } = await reviewedFlow(ctx)

    await act(async () => { await result.current.commit() })

    expect(result.current.errors).toEqual({ fields: {}, form: busy })
    expect(result.current.stage).toBe('review')
    expect(result.current.busy).toBe(false)

    await act(async () => { await result.current.commit() })
    expect(commits()[1]?.['idempotencyKey']).toBe(commits()[0]?.['idempotencyKey'])
    expect(result.current.stage).toBe('done')
  })

  it('names a file with no header row under the file input, and sends nothing for it', async () => {
    const server = fakeImportApi()
    const { result } = renderHook(useFlowOf(server))

    await act(async () => { await result.current.onFile(file('', 'empty.csv')) })

    expect(result.current.errors.fields['csv']).toMatch(/no header row/)
    expect(result.current.error).toBeNull()
    expect(server.callsTo('/upload/begin')).toHaveLength(0)
  })

  it('gives back the upload for a file that turns out to have no header row', async () => {
    const server = fakeImportApi()
    const { result } = renderHook(useFlowOf(server))

    await act(async () => { await result.current.onFile(file('\n\n\n', 'blank.csv')) })

    await waitFor(() => expect(server.store.liveCount('user-1')).toBe(0))
    expect(result.current.errors.fields['csv']).toMatch(/no header row/)
    expect(result.current.upload.phase).toBe('idle')
  })

  it('refuses a file over 8 MB on the file input, before reading it into the page or sending anything', async () => {
    const server = fakeImportApi()
    const { result } = renderHook(useFlowOf(server))

    await act(async () => { await result.current.onFile(file(`Date,Description\n${'x'.repeat(8_000_001)}`, 'huge.csv')) })

    expect(result.current.errors.fields['csv']).toMatch(/larger than 8 MB/)
    expect(result.current.stage).toBe('choose')
    expect(server.calls.filter((c) => c.path.includes('/upload/'))).toHaveLength(0)
  })
})

describe('useImportFlow staging', () => {
  it('starts sending the file as soon as it is chosen, and analyses by upload id without the text', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))

    await act(async () => { await result.current.onFile(file()) })

    // Nothing was asked of analyze yet; the file is already on its way.
    expect(server.callsTo('/analyze')).toHaveLength(0)
    await waitFor(() => expect(result.current.upload.phase).toBe('ready'))
    expect(server.callsTo('/upload/begin')[0]?.body).toEqual({ chunks: 1, bytes: new TextEncoder().encode(CSV).length })

    await act(async () => { await result.current.analyze() })

    const body = server.callsTo('/analyze')[0]!.body
    expect(body['uploadId']).toEqual(expect.any(String))
    expect(body).not.toHaveProperty('csv')
  })

  it('makes the check wait for an upload that is still running', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    server.intercept('/upload/chunk', () => gate)
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(file()) })
    expect(result.current.upload.phase).toBe('uploading')

    let checking!: Promise<void>
    act(() => { checking = result.current.analyze() })
    await new Promise((r) => setTimeout(r, 20))
    expect(server.callsTo('/analyze')).toHaveLength(0)
    expect(result.current.busy).toBe(true)

    await act(async () => { release(); await checking })
    expect(server.callsTo('/analyze')).toHaveLength(1)
    expect(result.current.stage).toBe('review')
  })

  it('sends the file again, once, when the server has lost it by the time of the check', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(file()) })
    await waitFor(() => expect(result.current.upload.phase).toBe('ready'))

    server.restartServer() // expired, or the server restarted, while the person was mapping
    await act(async () => { await result.current.analyze() })

    expect(server.callsTo('/upload/begin')).toHaveLength(2)
    expect(server.callsTo('/analyze')).toHaveLength(2)
    expect(server.callsTo('/analyze')[1]?.body['uploadId']).not.toBe(server.callsTo('/analyze')[0]?.body['uploadId'])
    expect(result.current.stage).toBe('review')
  })

  it('says the server no longer has the file when sending it again does not help', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    server.intercept('/analyze', () => { throw failure(404, 'upload_not_found', 'That upload is not available.') })
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(file()) })

    await act(async () => { await result.current.analyze() })

    expect(server.callsTo('/upload/begin')).toHaveLength(2)
    expect(result.current.errors.form).toMatch(/no longer has your file/)
    expect(result.current.stage).toBe('map')
  })

  it('does the same for a commit, with the same key', async () => {
    const { server, ctx, commits } = commitContext(0)
    const { result } = await reviewedFlow(ctx)
    server.restartServer()

    await act(async () => { await result.current.commit() })

    expect(server.callsTo('/upload/begin')).toHaveLength(2)
    expect(commits()).toHaveLength(2)
    expect(commits()[1]?.['idempotencyKey']).toBe(commits()[0]?.['idempotencyKey'])
    expect(result.current.stage).toBe('done')
  })

  it('shows why an upload failed, and tries again when the person asks for the check', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    server.intercept('/upload/begin', (_call, nth) => {
      if (nth === 1) throw failure(503, 'staging_full', 'Other uploads are using all the space for staged files right now. Try again in about 30 seconds.')
    })
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(file()) })

    await waitFor(() => expect(result.current.upload.phase).toBe('failed'))
    expect(result.current.upload.message).toMatch(/Try again in about 30 seconds/)
    expect(result.current.stage).toBe('map')

    await act(async () => { await result.current.analyze() })

    expect(server.callsTo('/upload/begin')).toHaveLength(2)
    expect(result.current.stage).toBe('review')
  })

  it('gives back the first file\'s upload when another file is chosen, so the person is never held at two', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))

    for (const name of ['a.csv', 'b.csv', 'c.csv', 'd.csv']) {
      await act(async () => { await result.current.onFile(file(CSV, name)) })
    }

    await waitFor(() => expect(result.current.upload.phase).toBe('ready'))
    await waitFor(() => expect(server.store.liveCount('user-1')).toBe(1))
    expect(server.callsTo('/upload/begin')).toHaveLength(4)
    expect(result.current.fileName).toBe('d.csv')
  })

  it('ignores the answer for the first file when another is chosen while it is being analysed', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS, analyze: (_b, csv) => ({
      summary: {}, errors: [], rows: [], flagged: { total: 0, offset: 0, rows: [] }, from: csv.length,
    }) })
    let release!: () => void
    server.intercept('/analyze', () => new Promise<void>((r) => { release = r }))
    const { result } = renderHook(useFlowOf(server))
    await waitFor(() => expect(result.current.accountId).not.toBe(''))
    await act(async () => { await result.current.onFile(file()) })
    await waitFor(() => expect(result.current.upload.phase).toBe('ready'))

    let checking!: Promise<void>
    act(() => { checking = result.current.analyze() })
    await waitFor(() => expect(server.callsTo('/analyze')).toHaveLength(1))
    await act(async () => { await result.current.onFile(file(`${CSV}\n03/06/2026,TEA,-3.00`, 'other.csv')) })
    await act(async () => { release(); await checking })

    expect(result.current.stage).toBe('map')
    expect(result.current.analysis).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('gives the upload back on reset and when the page is left', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    const hook = renderHook(useFlowOf(server))
    await act(async () => { await hook.result.current.onFile(file()) })
    await waitFor(() => expect(hook.result.current.upload.phase).toBe('ready'))
    expect(server.store.liveCount('user-1')).toBe(1)

    act(() => hook.result.current.reset())
    await waitFor(() => expect(server.store.liveCount('user-1')).toBe(0))

    await act(async () => { await hook.result.current.onFile(file()) })
    await waitFor(() => expect(hook.result.current.upload.phase).toBe('ready'))
    hook.unmount()
    await waitFor(() => expect(server.store.liveCount('user-1')).toBe(0))
  })

  it('gives the upload back on pagehide too, which is how a frame that is going away is told', async () => {
    const server = fakeImportApi({ accounts: ACCOUNTS })
    const hook = renderHook(useFlowOf(server))
    await act(async () => { await hook.result.current.onFile(file()) })
    await waitFor(() => expect(hook.result.current.upload.phase).toBe('ready'))

    window.dispatchEvent(new Event('pagehide'))

    await waitFor(() => expect(server.store.liveCount('user-1')).toBe(0))
  })

  it('does not give back an upload the server has already imported', async () => {
    const { server, ctx } = commitContext(0)
    const { result } = await reviewedFlow(ctx)
    await act(async () => { await result.current.commit() })
    act(() => result.current.reset())
    await new Promise((r) => setTimeout(r, 20))
    expect(server.callsTo('/upload/abort')).toHaveLength(0)
  })
})

describe('useImportFlow loadMoreFlagged', () => {
  const row = (n: number) => ({
    rowNumber: n, date: '2026-03-04', merchant: `SHOP ${n}`, amount: '-1.00', notes: null, externalId: null,
    status: 'needs-review', reason: 'looks like SHOP', matched: null,
  })

  /** A server that has 5 flagged rows and sends them 2 at a time. */
  function pagedContext(overlap = false) {
    const server = fakeImportApi({
      accounts: ACCOUNTS,
      analyze: (body) => {
        const offset = typeof body['flaggedOffset'] === 'number' ? body['flaggedOffset'] : 0
        const rows = overlap && offset === 2 ? [3, 4] : [2, 3, 4, 5, 6].slice(offset, offset + 2)
        const page = rows.map(row)
        return {
          summary: { total: 5, new: 0, duplicate: 0, needsReview: 5, errors: 0 },
          errors: [], rows: page, flagged: { total: 5, offset, rows: page },
        }
      },
    })
    return { server, ctx: ctxOf(server) }
  }

  it('asks for the page after the rows it has, with the file it analysed, and appends the answer', async () => {
    const { server, ctx } = pagedContext()
    const { result } = await reviewedFlow(ctx)
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3])

    await act(async () => { expect(await result.current.loadMoreFlagged()).toBe(true) })
    const analyses = server.callsTo('/analyze').map((c) => c.body)
    expect(analyses[1]?.['flaggedOffset']).toBe(2)
    expect(analyses[1]?.['uploadId']).toBe(analyses[0]?.['uploadId'])
    expect(analyses[1]).not.toHaveProperty('csv')
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5])

    await act(async () => { await result.current.loadMoreFlagged() })
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5, 6])
  })

  it('lists a row once even when two pages overlap', async () => {
    const { ctx } = pagedContext(true)
    const { result } = await reviewedFlow(ctx)
    await act(async () => { await result.current.loadMoreFlagged() })
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4])
  })

  it('keeps the rows it has and reports the failure when the page cannot be loaded', async () => {
    const { server, ctx } = pagedContext()
    const { result } = await reviewedFlow(ctx)
    server.intercept('/analyze', () => { throw new Error('network down') })
    await act(async () => { expect(await result.current.loadMoreFlagged()).toBe(false) })
    expect(result.current.errors.form).toBe('network down')
    expect(result.current.analysis?.flagged.rows).toHaveLength(2)
  })

  it('sends the file again when the server has lost it between two pages', async () => {
    const { server, ctx } = pagedContext()
    const { result } = await reviewedFlow(ctx)
    server.restartServer()
    await act(async () => { expect(await result.current.loadMoreFlagged()).toBe(true) })
    expect(server.callsTo('/upload/begin')).toHaveLength(2)
    expect(result.current.analysis?.flagged.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5])
  })

  it('does nothing before there is an analysis', async () => {
    const { server, ctx } = pagedContext()
    const { result } = renderHook(() => useImportFlow(ctx))
    await act(async () => { expect(await result.current.loadMoreFlagged()).toBe(false) })
    expect(server.callsTo('/analyze')).toHaveLength(0)
  })
})
