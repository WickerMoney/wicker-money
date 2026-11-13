import type { PluginApi } from '@wickermoney/plugin-sdk'
import { vi } from 'vitest'
import { UploadStore } from '../../server/staging/UploadStore.js'
import type { ImportAccount } from '../models/index.js'
import type { UploadStoreOptions } from '../../server/staging/UploadStoreOptions.js'

/** One request the page made, as the fake server saw it. */
export interface RecordedCall {
  readonly path: string
  readonly body: Record<string, unknown>
}

/** Runs before the real handling of a request; throw to refuse it (see {@link failure}). */
export type Interceptor = (call: RecordedCall, nth: number) => void | Promise<void>

/** An error shaped like the one the frame's and the host's API clients raise. */
export function failure(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code })
}

/**
 * A stand-in for the plugin's routes that keeps the real rules: staging goes
 * through the server's own `UploadStore`, so limits, ids, expiry and the exact
 * answers are the ones the page meets. `analyze` and `commit` read the staged
 * text by `uploadId` as the real routes do and hand it to the test's handlers.
 */
export function fakeImportApi(options: {
  readonly accounts?: readonly ImportAccount[]
  readonly store?: UploadStoreOptions
  readonly analyze?: (body: Record<string, unknown>, csv: string) => unknown
  readonly commit?: (body: Record<string, unknown>, csv: string) => unknown
} = {}) {
  let store = new UploadStore(options.store)
  const calls: RecordedCall[] = []
  const interceptors = new Map<string, Interceptor>()
  const counts = new Map<string, number>()
  const results = new Map<string, unknown>()
  const USER = 'user-1'
  const accounts = options.accounts ?? [{ id: '00000000-0000-4000-8000-000000000001', name: 'Checking' } as ImportAccount]

  const asApiError = (e: unknown): never => {
    const f = e as { statusCode?: number; code?: string; message?: string }
    if (typeof f.statusCode === 'number') throw failure(f.statusCode, f.code ?? 'import_failed', f.message ?? '')
    throw e
  }

  const post = vi.fn(async (path: string, body: Record<string, unknown> = {}, _init?: RequestInit): Promise<unknown> => {
    const call = { path, body }
    calls.push(call)
    const key = path.replace(/^.*\/p\/wickermoney\.import-csv/, '')
    const nth = (counts.get(key) ?? 0) + 1
    counts.set(key, nth)
    await interceptors.get(key)?.(call, nth)
    try {
      switch (key) {
        case '/upload/begin': return store.begin(USER, body['chunks'], body['bytes'])
        case '/upload/chunk': return store.addChunk(USER, body['uploadId'] as string, body['index'], body['text'])
        case '/upload/finish': return store.finish(USER, body['uploadId'] as string)
        case '/upload/abort': store.abort(USER, body['uploadId'] as string); return {}
        case '/analyze': {
          const staged = store.lookup(USER, body['uploadId'] as string)
          if (staged.state !== 'ready') throw failure(404, 'upload_not_found', 'gone')
          return options.analyze?.(body, staged.csv) ?? { summary: {}, errors: [], rows: [], flagged: { total: 0, offset: 0, rows: [] } }
        }
        case '/commit': {
          const id = body['uploadId'] as string
          const staged = store.lookup(USER, id)
          if (staged.state === 'committed') {
            // Only a retry of that very commit (same key) is answered, as the real route does.
            if (body['idempotencyKey'] === staged.receipt.idempotencyKey) return { ...(results.get(id) as object), replayed: true }
            throw failure(404, 'upload_not_found', 'gone')
          }
          const result = options.commit?.(body, staged.csv) ?? { imported: 2, skipped: 0, flagged: 0, failed: 0 }
          results.set(id, result)
          store.markCommitted(USER, id, typeof body['idempotencyKey'] === 'string' ? { idempotencyKey: body['idempotencyKey'], failed: 0 } : undefined)
          return result
        }
        default: return {}
      }
    } catch (e) {
      return asApiError(e)
    }
  })

  const get = vi.fn(async (path: string) => (path.endsWith('/mappings') ? { mappings: [] } : { accounts }))

  return {
    api: { get, post } as unknown as Pick<PluginApi, 'get' | 'post'>,
    /** The `post` behind `api`, to read or replace its behaviour. */
    post,
    calls,
    get store() { return store },
    /** Forget every staged upload, as a restarted server would. */
    restartServer() { store = new UploadStore(options.store) },
    /** Runs `fn` before the route named (e.g. `/upload/chunk`) handles each request. */
    intercept(route: string, fn: Interceptor) { interceptors.set(route, fn) },
    callsTo: (route: string) => calls.filter((c) => c.path.endsWith(route)),
  }
}
