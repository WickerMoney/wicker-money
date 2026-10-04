import { validationIssuesOf } from '@wickermoney/ui-kit'
import { ApiError } from './ApiError.js'
import { buildRequestHeaders } from './buildRequestHeaders.js'
import type { RequestOptions } from './RequestOptions.js'
import { tokenExpiry } from './tokenExpiry.js'

const BASE = '/api/v1'

/**
 * Header the server requires on cookie-authenticated endpoints (refresh and
 * logout). A cross-site form or `fetch` without CORS approval cannot set a
 * custom header, which is what makes the cookie unusable for forged requests.
 */
const CSRF_HEADER = 'x-wickermoney-csrf'

/** How long before the access token's expiry a request refreshes it first. */
const REFRESH_MARGIN_MS = 30_000

/**
 * The current access token.
 *
 * Held in a module-local variable rather than in storage: a token in storage
 * is readable by any script on the origin, including plugin code. It is not
 * airtight (plugin code shares this realm), but it removes the trivial path,
 * and the scoped client handed to plugins never exposes it. The refresh token
 * is not held here at all; it is an HttpOnly cookie.
 */
let accessToken: string | null = null

/** When the access token expires, as epoch milliseconds, or `null` when unknown. */
let accessExpiresAt: number | null = null

/**
 * Bumped whenever the session is replaced or ended by the caller, so a refresh
 * that started before a sign-out cannot resurrect the session when it lands.
 */
let sessionEpoch = 0

/** Called when the session is over: a refresh was refused, or a retried request was still rejected. */
let onUnauthorized: (() => void) | null = null

/** The refresh in progress, shared by every request that needs one. */
let inflightRefresh: Promise<{ accessToken: string } | null> | null = null

/**
 * Stores (or clears) the access token attached to subsequent requests.
 *
 * @param next - The new access token, or `null` to sign out.
 */
export function setAccessToken(next: string | null): void {
  sessionEpoch += 1
  applyToken(next)
}

/** Stores a token without touching the session epoch. */
function applyToken(next: string | null): void {
  accessToken = next
  accessExpiresAt = next === null ? null : tokenExpiry(next)
}

/**
 * Registers the callback invoked when the session can no longer be kept alive.
 *
 * @param fn - Called with no arguments; replaces any previously registered handler.
 */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

/**
 * Converts a failed response into an `ApiError`, using the body's `code`, `message` and
 * `issues` when it is JSON.
 *
 * @param res - A response whose status is not successful.
 * @returns An `ApiError` carrying the HTTP status and error code.
 */
async function parseError(res: Response): Promise<ApiError> {
  let code = 'request_failed'
  let message = `Request failed (${res.status})`
  let issues: ApiError['issues'] = []
  try {
    const body = (await res.json()) as { code?: string; message?: string }
    if (typeof body.code === 'string') code = body.code
    if (typeof body.message === 'string') message = body.message
    issues = validationIssuesOf(body)
  } catch {
    // Non-JSON error body; the defaults above are fine.
  }
  return new ApiError(message, res.status, code, issues)
}

/** Ends the local session and tells the registered handler. */
function endSession(): void {
  applyToken(null)
  onUnauthorized?.()
}

/**
 * Exchanges the refresh cookie for a new access token.
 *
 * @param signal - Cancels the exchange.
 * @returns The parsed response body.
 * @throws {ApiError} When the server refuses the exchange.
 */
async function exchangeRefreshCookie(signal?: AbortSignal | null): Promise<unknown> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { [CSRF_HEADER]: '1' },
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw await parseError(res)
  return res.json()
}

/**
 * Runs one refresh and installs the new access token.
 *
 * @returns The response body when a new token is in place, or `null` when the
 * refresh was refused with a 401 or superseded by a sign-in or sign-out (the
 * session is over).
 * @throws {Error} On a network failure or a non-401 error response, so the caller
 * can keep the session: a transient outage must not sign the user out.
 */
async function runRefresh(): Promise<{ accessToken: string } | null> {
  const epoch = sessionEpoch
  let body: unknown
  try {
    body = await exchangeRefreshCookie()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (epoch === sessionEpoch) endSession()
      return null
    }
    throw error
  }
  if (epoch !== sessionEpoch) return null
  const token = (body as { accessToken?: unknown } | null)?.accessToken
  if (typeof token !== 'string') {
    endSession()
    return null
  }
  applyToken(token)
  return body as { accessToken: string }
}

/**
 * Refreshes the access token, sharing one exchange between concurrent callers.
 *
 * The server rotates the refresh cookie on every exchange, so two parallel
 * exchanges would each present the same cookie and the second would look like
 * token reuse. Every caller that arrives while one is in flight waits for it.
 */
function refreshOnce(): Promise<{ accessToken: string } | null> {
  inflightRefresh ??= runRefresh().finally(() => { inflightRefresh = null })
  return inflightRefresh
}

/**
 * Resumes a session from the refresh cookie, for page load.
 *
 * The response body is whatever the login endpoint returns, so the caller can
 * read the user from it. The access token is installed here and never handed out.
 * Shares the single in-flight exchange, so a development double-mount cannot
 * present the same cookie twice.
 *
 * @returns The refresh response body, or `null` when there is no valid session.
 * @throws {Error} On a network failure or a non-401 error response.
 */
export async function resumeSession<T extends { accessToken: string }>(): Promise<T | null> {
  return (await refreshOnce()) as T | null
}

/**
 * Refreshes ahead of a request when the token is about to expire.
 *
 * A failure is ignored: the request goes ahead with the token it has and the
 * ordinary 401 path decides what to do next.
 */
async function refreshIfExpiring(): Promise<void> {
  if (accessToken === null || accessExpiresAt === null) return
  if (Date.now() < accessExpiresAt - REFRESH_MARGIN_MS) return
  try {
    await refreshOnce()
  } catch {
    // Handled by the 401 path if the token really has expired.
  }
}

/**
 * Sends one request with whatever token is current.
 *
 * @returns The response and the token it was sent with.
 */
async function send(
  path: string, init: RequestInit, headers: Headers, anonymous: boolean,
): Promise<{ res: Response; sentWith: string | null }> {
  const sentWith = anonymous ? null : accessToken
  const merged = new Headers(headers)
  if (sentWith !== null) merged.set('authorization', `Bearer ${sentWith}`)
  const res = await fetch(`${BASE}${path}`, { ...init, headers: merged, credentials: 'same-origin' })
  return { res, sentWith }
}

/**
 * Decides whether a rejected request is worth retrying.
 *
 * Another request may already have refreshed while this one was in flight;
 * then the current token is newer than the one that was rejected. Otherwise a
 * refresh is attempted.
 *
 * @param rejected - The 401 response.
 * @param sentWith - The token the rejected request carried.
 * @returns `true` when a usable token is now in place.
 * @throws {ApiError} The original rejection, when the refresh could not be attempted (offline, server error): the session is kept.
 */
async function canRetryAfterRejection(rejected: Response, sentWith: string | null): Promise<boolean> {
  if (accessToken !== null && accessToken !== sentWith) return true
  try {
    return (await refreshOnce()) !== null
  } catch {
    throw await parseError(rejected)
  }
}

/**
 * Retries a rejected request once with a fresh token.
 *
 * @returns The retry's response.
 * @throws {ApiError} The original rejection when no usable token could be had, or the retry's own rejection (which also ends the session) when it is a 401 too.
 */
async function retryAfterUnauthorized(
  path: string, init: RequestInit, headers: Headers, rejected: Response, sentWith: string | null,
): Promise<Response> {
  if (!(await canRetryAfterRejection(rejected, sentWith))) throw await parseError(rejected)
  const { res } = await send(path, init, headers, false)
  if (res.status === 401) {
    endSession()
    throw await parseError(res)
  }
  return res
}

/**
 * Sends a request to the API and parses the JSON response.
 *
 * A 401 on an authenticated request triggers one silent refresh and one retry.
 * The session is ended only when the refresh is refused or the retry is
 * rejected too.
 *
 * @param path - Path relative to the API root (`/api/v1`), starting with `/`.
 * @param options - Fetch options plus `anonymous` (omit the bearer token),
 * `pluginId` (identifies the calling plugin to the server) and `signal`.
 * @returns The parsed body, or `undefined` for a 204.
 * @throws {ApiError} On any non-2xx response.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { pluginId, anonymous, headers, ...init } = options
  const isAnonymous = anonymous === true
  const merged = buildRequestHeaders(headers, init.body !== undefined, pluginId)

  if (!isAnonymous) await refreshIfExpiring()
  const first = await send(path, init, merged, isAnonymous)
  const res =
    first.res.status === 401 && !isAnonymous
      ? await retryAfterUnauthorized(path, init, merged, first.res, first.sentWith)
      : first.res

  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Headers that mark a request as deliberate for the cookie-authenticated
 * endpoints. Spread into the options of `logout`.
 */
export const CSRF_HEADERS: Readonly<Record<string, string>> = { [CSRF_HEADER]: '1' }

/** Typed convenience wrappers over {@link request}, one per HTTP verb. Bodies are JSON-serialised. */
export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
}
