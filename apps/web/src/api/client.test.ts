import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './ApiError.js'
import { api, request, resumeSession, setAccessToken, setUnauthorizedHandler } from './client.js'
import { responseCache } from './responseCache.js'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Builds an unsigned JWT-shaped token expiring `seconds` from now. */
function tokenExpiringIn(seconds: number, tag = 'a'): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds, tag }))
  return `h.${payload.replace(/=+$/, '')}.s`
}

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>
let unauthorized: ReturnType<typeof vi.fn<() => void>>

function route(handler: Handler): void {
  fetchMock.mockImplementation(async (url, init) => handler(url, init))
}

const authHeader = (init: RequestInit): string | null => new Headers(init.headers).get('authorization')
const callsTo = (path: string): number => fetchMock.mock.calls.filter(([u]) => u === `/api/v1${path}`).length

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  unauthorized = vi.fn<() => void>()
  setUnauthorizedHandler(unauthorized)
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('an authenticated request', () => {
  it('sends the access token as a bearer credential', async () => {
    setAccessToken('tok-1')
    route(() => json({ ok: true }))

    await expect(api.get('/accounts')).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/accounts')
    expect(authHeader(init)).toBe('Bearer tok-1')
  })

  it('returns undefined for a 204', async () => {
    setAccessToken('tok-1')
    route(() => new Response(null, { status: 204 }))
    await expect(api.del('/things/1')).resolves.toBeUndefined()
  })

  it('reports a non-JSON error body with the status and a default code', async () => {
    setAccessToken('tok-1')
    route(() => new Response('<html>Bad gateway</html>', { status: 502 }))

    const error = await api.get('/accounts').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 502, code: 'request_failed', message: 'Request failed (502)' })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('uses the code and message of a JSON error body', async () => {
    setAccessToken('tok-1')
    route(() => json({ code: 'conflict', message: 'Name taken' }, 409))

    await expect(api.post('/accounts', {})).rejects.toMatchObject({ status: 409, code: 'conflict', message: 'Name taken' })
  })

  it('keeps the field-level issues of a validation failure', async () => {
    setAccessToken('tok-1')
    const issues = [{ path: ['conditions', 0, 'amountMin'], message: 'Must be more than 0. Leave it empty for no minimum.' }]
    route(() => json({ code: 'validation_failed', message: 'conditions.0.amountMin: Must be more than 0.', issues }, 400))

    await expect(api.post('/category-rules', {})).rejects.toMatchObject({ status: 400, code: 'validation_failed', issues })
  })

  it('has no issues when the body carries none', async () => {
    setAccessToken('tok-1')
    route(() => json({ code: 'conflict', message: 'Name taken' }, 409))

    await expect(api.post('/accounts', {})).rejects.toMatchObject({ issues: [] })
  })

  it('passes an abort signal through to fetch', async () => {
    setAccessToken('tok-1')
    route(() => json({}))
    const controller = new AbortController()

    await request('/accounts', { signal: controller.signal })

    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal)
  })
})

describe('an anonymous request', () => {
  it('sends no credential and neither refreshes nor signs out on a 401', async () => {
    setAccessToken('tok-1')
    route(() => json({ code: 'invalid_credentials', message: 'Bad login' }, 401))

    await expect(api.post('/auth/login', {}, { anonymous: true })).rejects.toMatchObject({ status: 401 })

    expect(authHeader(fetchMock.mock.calls[0]![1])).toBeNull()
    expect(callsTo('/auth/refresh')).toBe(0)
    expect(unauthorized).not.toHaveBeenCalled()
  })
})

describe('a 401 on an authenticated request', () => {
  it('refreshes once, retries with the new token and keeps the session', async () => {
    setAccessToken('old')
    route((url, init) => {
      if (url === '/api/v1/auth/refresh') return json({ accessToken: 'new', user: { id: 'u' } })
      return authHeader(init) === 'Bearer new' ? json({ data: 1 }) : json({ code: 'unauthorized' }, 401)
    })

    await expect(api.get('/accounts')).resolves.toEqual({ data: 1 })

    expect(callsTo('/accounts')).toBe(2)
    expect(callsTo('/auth/refresh')).toBe(1)
    expect(unauthorized).not.toHaveBeenCalled()
    // The new token is now the one in use.
    await api.get('/accounts')
    expect(authHeader(fetchMock.mock.calls.at(-1)![1])).toBe('Bearer new')
  })

  it('sends the refresh as a same-origin, CSRF-marked POST with no body', async () => {
    setAccessToken('old')
    route((url, init) => {
      if (url === '/api/v1/auth/refresh') return json({ accessToken: 'new' })
      return authHeader(init) === 'Bearer new' ? json({}) : json({}, 401)
    })

    await api.get('/accounts')

    const refresh = fetchMock.mock.calls.find(([u]) => u === '/api/v1/auth/refresh')!
    expect(refresh[1].method).toBe('POST')
    expect(refresh[1].body).toBeUndefined()
    expect(refresh[1].credentials).toBe('same-origin')
    expect(new Headers(refresh[1].headers).get('x-wickermoney-csrf')).toBe('1')
    expect(new Headers(refresh[1].headers).get('authorization')).toBeNull()
  })

  it('shares one refresh between concurrent 401s', async () => {
    setAccessToken('old')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    route(async (url, init) => {
      if (url === '/api/v1/auth/refresh') {
        await gate
        return json({ accessToken: 'new' })
      }
      return authHeader(init) === 'Bearer new' ? json({ path: url }) : json({}, 401)
    })

    const all = Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
    await vi.waitFor(() => { expect(callsTo('/auth/refresh')).toBe(1) })
    release()

    await expect(all).resolves.toHaveLength(3)
    expect(callsTo('/auth/refresh')).toBe(1)
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('does not refresh again for a request whose token was already replaced', async () => {
    setAccessToken('old')
    let release: () => void = () => {}
    const slow = new Promise<void>((resolve) => { release = resolve })
    route(async (url, init) => {
      if (url === '/api/v1/auth/refresh') return json({ accessToken: 'new' })
      if (url === '/api/v1/slow') { await slow; return authHeader(init) === 'Bearer new' ? json({ ok: 1 }) : json({}, 401) }
      return authHeader(init) === 'Bearer new' ? json({ ok: 2 }) : json({}, 401)
    })

    const slowRequest = api.get('/slow')
    await api.get('/fast') // refreshes while /slow is still in flight
    release()

    await expect(slowRequest).resolves.toEqual({ ok: 1 })
    expect(callsTo('/auth/refresh')).toBe(1)
  })

  it('signs out through the handler when the refresh is refused', async () => {
    setAccessToken('old')
    route((url) => (url === '/api/v1/auth/refresh' ? json({ code: 'unauthorized' }, 401) : json({}, 401)))

    await expect(api.get('/accounts')).rejects.toMatchObject({ status: 401 })

    expect(unauthorized).toHaveBeenCalledTimes(1)
    expect(callsTo('/accounts')).toBe(1) // not retried
    // The dead token is gone: later requests carry no credential.
    route(() => json({}))
    await api.get('/accounts')
    expect(authHeader(fetchMock.mock.calls.at(-1)![1])).toBeNull()
  })

  it('signs out when the retried request is rejected as well', async () => {
    setAccessToken('old')
    route((url) => (url === '/api/v1/auth/refresh' ? json({ accessToken: 'new' }) : json({}, 401)))

    await expect(api.get('/accounts')).rejects.toMatchObject({ status: 401 })

    expect(callsTo('/accounts')).toBe(2)
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('keeps the session when the refresh fails for a transient reason', async () => {
    setAccessToken('old')
    route((url) => {
      if (url === '/api/v1/auth/refresh') throw new TypeError('Failed to fetch')
      return json({}, 401)
    })

    await expect(api.get('/accounts')).rejects.toMatchObject({ status: 401 })

    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('keeps the session when the refresh answers 500', async () => {
    setAccessToken('old')
    route((url) => (url === '/api/v1/auth/refresh' ? json({ code: 'boom' }, 500) : json({}, 401)))

    await expect(api.get('/accounts')).rejects.toMatchObject({ status: 401 })

    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('does not let a refresh that began before sign-out revive the session', async () => {
    setAccessToken('old')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    route(async (url) => {
      if (url === '/api/v1/auth/refresh') { await gate; return json({ accessToken: 'revived' }) }
      return json({}, 401)
    })

    const pending = api.get('/accounts').catch((e: unknown) => e)
    await vi.waitFor(() => { expect(callsTo('/auth/refresh')).toBe(1) })
    setAccessToken(null) // the user signs out meanwhile
    release()
    await pending

    route(() => json({}))
    await api.get('/accounts')
    expect(authHeader(fetchMock.mock.calls.at(-1)![1])).toBeNull()
  })
})

describe('proactive refresh', () => {
  it('refreshes before sending when the token is about to expire', async () => {
    setAccessToken(tokenExpiringIn(5, 'stale'))
    const fresh = tokenExpiringIn(900, 'fresh')
    route((url) => (url === '/api/v1/auth/refresh' ? json({ accessToken: fresh }) : json({ ok: true })))

    await api.get('/accounts')

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/auth/refresh')
    expect(authHeader(fetchMock.mock.calls[1]![1])).toBe(`Bearer ${fresh}`)
  })

  it('leaves a token with plenty of life alone', async () => {
    setAccessToken(tokenExpiringIn(900))
    route(() => json({ ok: true }))

    await api.get('/accounts')

    expect(callsTo('/auth/refresh')).toBe(0)
  })

  it('ignores a token whose expiry it cannot read', async () => {
    setAccessToken('opaque-token')
    route(() => json({ ok: true }))

    await api.get('/accounts')

    expect(callsTo('/auth/refresh')).toBe(0)
  })

  it('still sends the request when the early refresh fails', async () => {
    const token = tokenExpiringIn(5)
    setAccessToken(token)
    route((url) => {
      if (url === '/api/v1/auth/refresh') throw new TypeError('offline')
      return json({ ok: true })
    })

    await expect(api.get('/accounts')).resolves.toEqual({ ok: true })
    expect(authHeader(fetchMock.mock.calls.at(-1)![1])).toBe(`Bearer ${token}`)
  })
})

describe('resumeSession', () => {
  it('returns the refresh body and installs its token', async () => {
    route(() => json({ accessToken: 'fresh', user: { id: 'u1' } }))

    await expect(resumeSession()).resolves.toMatchObject({ user: { id: 'u1' } })

    route(() => json({}))
    await api.get('/accounts')
    expect(authHeader(fetchMock.mock.calls.at(-1)![1])).toBe('Bearer fresh')
  })

  it('returns null and signs out when there is no session', async () => {
    route(() => json({ code: 'unauthorized' }, 401))

    await expect(resumeSession()).resolves.toBeNull()

    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('rejects on a network failure so the caller can tell it from "no session"', async () => {
    route(() => { throw new TypeError('offline') })

    await expect(resumeSession()).rejects.toBeInstanceOf(TypeError)
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('shares the in-flight exchange between simultaneous callers', async () => {
    route(() => json({ accessToken: 'fresh', user: { id: 'u1' } }))

    await Promise.all([resumeSession(), resumeSession()])

    expect(callsTo('/auth/refresh')).toBe(1)
  })
})

describe('the response cache', () => {
  const remember = async (userId = 'u1'): Promise<void> => {
    await responseCache.read(userId, 'GET /things', async () => 'v')
  }

  it('is left alone by reads', async () => {
    setAccessToken('tok-1')
    route(() => json({}))
    await remember()

    await api.get('/things')

    expect(responseCache.size('u1')).toBe(1)
  })

  it.each([
    ['POST', () => api.post('/things', { a: 1 })],
    ['PUT', () => api.put('/things/1', { a: 1 })],
    ['PATCH', () => api.patch('/things/1', { a: 1 })],
    ['DELETE', () => api.del('/things/1')],
  ])('is dropped, for every user and endpoint, by a %s', async (_verb, write) => {
    setAccessToken('tok-1')
    route(() => json({}))
    await remember('u1')
    await remember('u2')

    await write()

    expect(responseCache.size('u1') + responseCache.size('u2')).toBe(0)
  })

  it('is dropped before a write is sent and again when it settles', async () => {
    setAccessToken('tok-1')
    let release!: () => void
    route(() => new Promise<Response>((resolve) => { release = () => resolve(json({})) }))

    const write = api.post('/things', {})
    expect(responseCache.size('u1')).toBe(0)
    await remember() // a read that overlaps the write, answered from before it
    expect(responseCache.size('u1')).toBe(1)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await write

    expect(responseCache.size('u1')).toBe(0)
  })

  it('is dropped by a write that fails', async () => {
    setAccessToken('tok-1')
    route(() => json({ code: 'nope', message: 'No.' }, 422))
    await remember()

    await expect(api.post('/things', {})).rejects.toBeInstanceOf(ApiError)

    expect(responseCache.size('u1')).toBe(0)
  })

  it('is dropped when the token is replaced or cleared', async () => {
    setAccessToken('tok-1')
    await remember()
    setAccessToken('tok-2')
    expect(responseCache.size('u1')).toBe(0)

    await remember()
    setAccessToken(null)
    expect(responseCache.size('u1')).toBe(0)
  })

  it('is dropped when the session ends because a refresh was refused', async () => {
    setAccessToken('tok-1')
    route(() => json({ code: 'unauthorized' }, 401))
    await remember()

    await expect(api.get('/things')).rejects.toBeInstanceOf(ApiError)

    expect(responseCache.size('u1')).toBe(0)
  })

  const tokenFor = (sub: string): string => {
    const payload = btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 }))
    return `h.${payload.replace(/=+$/, '')}.s`
  }

  it('is dropped when a refresh hands back a different user\'s token', async () => {
    setAccessToken(tokenFor('u1'))
    route(() => json({ accessToken: tokenFor('u2') }))
    await remember()

    await resumeSession()

    expect(responseCache.size('u1')).toBe(0)
  })

  it('is kept when a refresh hands back the same user\'s token', async () => {
    setAccessToken(tokenFor('u1'))
    route(() => json({ accessToken: `${tokenFor('u1')}x` }))
    await remember()

    await resumeSession()

    expect(responseCache.size('u1')).toBe(1)
  })
})
