/** Options accepted by every API client call, in addition to the standard `fetch` options. */
export interface RequestOptions extends RequestInit {
  /**
   * Identifies the plugin a request is made for. The server checks it against
   * that plugin's manifest grants.
   */
  readonly pluginId?: string
  /**
   * When `true`, no credentials are attached and a 401 neither refreshes the
   * session nor signs the user out.
   */
  readonly anonymous?: boolean
  /**
   * Marks a non-GET request that changes no data the user can read, such as
   * minting a plugin token. It keeps the response cache instead of clearing it
   * as every other write does. Never set it on a request that changes anything
   * a remembered read could report.
   */
  readonly readOnly?: boolean
  /**
   * Aborts the request. An aborted request rejects with an `AbortError`, which
   * {@link isAbortError} recognises.
   */
  readonly signal?: AbortSignal | null
}
