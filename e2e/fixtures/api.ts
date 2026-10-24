import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'
import { PERSONAS, type PersonaKey } from './personas.js'

/**
 * A small API client for one persona: Playwright's `request` context, signed in
 * with the public seed login, sending the access token as a bearer token. It
 * talks to the same HTTP API the web app does, so a spec can arrange or check
 * state without the UI and without touching the database.
 */
export interface ApiClient {
  readonly persona: PersonaKey
  /** The signed-in user's id. */
  readonly userId: string
  /** The raw request context, for calls the helpers below do not cover. */
  readonly request: APIRequestContext
  /** GET a path (`/api/v1/...`) and return the parsed JSON, failing on a non-2xx status. */
  get<T = unknown>(path: string): Promise<T>
  /** POST a JSON body and return the parsed JSON, failing on a non-2xx status. */
  post<T = unknown>(path: string, body: unknown): Promise<T>
  /** GET a path and return only the status, for the calls that are meant to be refused. */
  status(path: string): Promise<number>
}

/** Signs `persona` in over the API and returns a client for it. */
export async function apiAs(request: APIRequestContext, persona: PersonaKey): Promise<ApiClient> {
  const { email, password } = PERSONAS[persona]
  const login = await request.post('/api/v1/auth/login', { data: { email, password } })
  expect(login.status(), `signing in as ${persona}`).toBe(200)
  const session = (await login.json()) as { accessToken: string; user: { id: string } }
  const headers = { authorization: `Bearer ${session.accessToken}` }
  return {
    persona,
    userId: session.user.id,
    request,
    async get<T>(path: string) {
      const res = await request.get(path, { headers })
      expect(res.ok(), `GET ${path} as ${persona} answered ${res.status()}`).toBe(true)
      return (await res.json()) as T
    },
    async post<T>(path: string, body: unknown) {
      const res = await request.post(path, { headers, data: body })
      expect(res.ok(), `POST ${path} as ${persona} answered ${res.status()}`).toBe(true)
      return (await res.json()) as T
    },
    async status(path: string) {
      return (await request.get(path, { headers })).status()
    },
  }
}
