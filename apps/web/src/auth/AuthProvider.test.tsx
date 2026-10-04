import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, setAccessToken } from '../api/client.js'
import { AuthProvider } from './AuthProvider.js'
import { useAuth } from './useAuth.js'
import type { AuthState } from './AuthState.js'

const USER = { id: 'u1', email: 'a@example.com', timezone: 'UTC', role: 'owner' as const }

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>
let auth: AuthState

function Probe() {
  auth = useAuth()
  return <p>{auth.ready ? (auth.user === null ? 'signed-out' : `in:${auth.user.email}`) : 'loading'}</p>
}

function mount() {
  return render(<AuthProvider><Probe /></AuthProvider>)
}

const callsTo = (path: string) => fetchMock.mock.calls.filter(([u]) => u === `/api/v1${path}`)
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken(null)
  localStorage.clear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('resuming a session at page load', () => {
  it('calls refresh with the cookie and signs the user in', async () => {
    fetchMock.mockResolvedValue(json({ accessToken: 'tok', user: USER }))

    mount()

    expect(await screen.findByText('in:a@example.com')).toBeTruthy()
    expect(callsTo('/auth/refresh')).toHaveLength(1)
    const init = callsTo('/auth/refresh')[0]![1]
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(header(init, 'x-wickermoney-csrf')).toBe('1')
  })

  it('shows the loading state until the refresh answers', async () => {
    let answer: (r: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { answer = resolve }))

    mount()
    expect(screen.getByText('loading')).toBeTruthy()

    await act(async () => { answer(json({ accessToken: 'tok', user: USER })) })
    expect(await screen.findByText('in:a@example.com')).toBeTruthy()
  })

  it('leaves the user signed out when there is no valid cookie', async () => {
    fetchMock.mockResolvedValue(json({ code: 'unauthorized' }, 401))

    mount()

    expect(await screen.findByText('signed-out')).toBeTruthy()
  })

  it('leaves the user signed out, rather than hanging, when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    mount()

    expect(await screen.findByText('signed-out')).toBeTruthy()
  })

  it('stores nothing about the session in web storage', async () => {
    fetchMock.mockResolvedValue(json({ accessToken: 'tok', user: USER }))

    mount()
    await screen.findByText('in:a@example.com')

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('signing in', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url) =>
      url === '/api/v1/auth/refresh'
        ? json({ code: 'unauthorized' }, 401)
        : json({ accessToken: 'tok-login', user: USER }))
  })

  it('posts the credentials anonymously and then authenticates requests with the access token', async () => {
    mount()
    await screen.findByText('signed-out')

    await act(async () => { await auth.signIn('a@example.com', 'correct horse battery') })

    expect(screen.getByText('in:a@example.com')).toBeTruthy()
    const login = callsTo('/auth/login')[0]![1]
    expect(JSON.parse(login.body as string)).toEqual({ email: 'a@example.com', password: 'correct horse battery' })
    expect(header(login, 'authorization')).toBeNull()

    await api.get('/accounts')
    expect(header(fetchMock.mock.calls.at(-1)![1], 'authorization')).toBe('Bearer tok-login')
    expect(localStorage.length).toBe(0)
  })

  it('registers the same way', async () => {
    mount()
    await screen.findByText('signed-out')

    await act(async () => { await auth.register('a@example.com', 'correct horse battery') })

    expect(callsTo('/auth/register')).toHaveLength(1)
    expect(screen.getByText('in:a@example.com')).toBeTruthy()
  })

  it("sends the browser's time zone when registering", async () => {
    mount()
    await screen.findByText('signed-out')
    fetchMock.mockResolvedValue(json({ accessToken: 'tok', user: USER }, 201))

    await act(async () => { await auth.register('a@example.com', 'correct horse battery') })

    const body = JSON.parse(callsTo('/auth/register')[0]![1].body as string) as { timezone?: string }
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('updates the user after setting the time zone', async () => {
    fetchMock.mockResolvedValue(json({ accessToken: 'tok', user: USER }))
    mount()
    await screen.findByText('in:a@example.com')
    fetchMock.mockResolvedValue(json({ ...USER, timezone: 'America/Chicago' }))

    await act(async () => { await auth.setTimezone('america/chicago') })

    const patch = callsTo('/auth/me')[0]![1]
    expect(patch.method).toBe('PATCH')
    expect(JSON.parse(patch.body as string)).toEqual({ timezone: 'america/chicago' })
    expect(auth.user?.timezone).toBe('America/Chicago')
  })

  it('surfaces a rejected login and stays signed out', async () => {
    mount()
    await screen.findByText('signed-out')
    fetchMock.mockImplementation(async () => json({ code: 'invalid_credentials', message: 'Wrong password' }, 401))

    await expect(auth.signIn('a@example.com', 'nope')).rejects.toThrow('Wrong password')

    expect(screen.getByText('signed-out')).toBeTruthy()
  })
})

describe('signing out', () => {
  async function signedIn() {
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/v1/auth/refresh') return json({ accessToken: 'tok', user: USER })
      if (url === '/api/v1/auth/logout') return new Response(null, { status: 204 })
      return json({})
    })
    mount()
    await screen.findByText('in:a@example.com')
  }

  it('calls logout with the CSRF header, then drops the user and the token', async () => {
    await signedIn()

    await act(async () => { await auth.signOut() })

    const logout = callsTo('/auth/logout')[0]![1]
    expect(logout.method).toBe('POST')
    expect(header(logout, 'x-wickermoney-csrf')).toBe('1')
    expect(header(logout, 'authorization')).toBe('Bearer tok')
    expect(screen.getByText('signed-out')).toBeTruthy()

    await api.get('/accounts')
    expect(header(fetchMock.mock.calls.at(-1)![1], 'authorization')).toBeNull()
  })

  it('signs out locally even when the logout request fails', async () => {
    await signedIn()
    fetchMock.mockRejectedValue(new TypeError('offline'))

    await act(async () => { await auth.signOut().catch(() => {}) })

    expect(screen.getByText('signed-out')).toBeTruthy()
  })
})

describe('when the session cannot be kept alive', () => {
  it('signs the user out once a 401 cannot be refreshed', async () => {
    let refreshes = 0
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/v1/auth/refresh') {
        refreshes += 1
        return refreshes === 1 ? json({ accessToken: 'tok', user: USER }) : json({ code: 'unauthorized' }, 401)
      }
      return json({ code: 'unauthorized' }, 401)
    })
    mount()
    await screen.findByText('in:a@example.com')

    await act(async () => { await api.get('/accounts').catch(() => {}) })

    await waitFor(() => { expect(screen.getByText('signed-out')).toBeTruthy() })
  })
})
