import { api, parseError } from '../../api/client.js'
import type { PluginRequestMethod } from '@wickermoney/plugin-sdk/isolated'

/** What a freshly minted plugin token looks like to the broker. */
export interface MintedToken {
  /** The bearer token. Never leaves the broker. */
  readonly token: string
  /** ISO 8601 expiry, from the server. */
  readonly expiresAt: string
}

/** One API request made on behalf of a plugin. */
export interface BrokerRequest {
  readonly method: PluginRequestMethod
  /** Relative to the API root, already checked by the grant rules. */
  readonly path: string
  readonly body?: unknown
  /** The plugin token; sent as the bearer and as nothing else. */
  readonly token: string
  readonly signal: AbortSignal
}

/** The two network operations the broker needs. Replaceable in tests. */
export interface BrokerApi {
  /** Mints a plugin token using the host's own credentials. */
  mint(pluginId: string): Promise<MintedToken>
  /** Sends one request with the plugin token. Rejects with an `ApiError` for a non-2xx response. */
  send(request: BrokerRequest): Promise<unknown>
}

const BASE = '/api/v1'

/**
 * The real network side of the broker.
 *
 * `mint` goes through the host's client, which holds the user's access token
 * and refreshes it. `send` deliberately does not: it uses the plugin token as
 * the only credential, omits cookies, and never retries with the host's token,
 * so a request made for a plugin can never carry more authority than the
 * plugin token has.
 */
export const hostBrokerApi: BrokerApi = {
  mint: (pluginId) => api.post<MintedToken>(`/plugins/${encodeURIComponent(pluginId)}/token`),

  async send({ method, path, body, token, signal }) {
    const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' })
    if (body !== undefined) headers.set('content-type', 'application/json')
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: 'omit',
    })
    if (!res.ok) throw await parseError(res)
    if (res.status === 204) return undefined
    return (await res.json()) as unknown
  },
}
