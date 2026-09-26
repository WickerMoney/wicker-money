/**
 * Builds the headers every API request starts from.
 *
 * @param headers - Headers the caller supplied.
 * @param hasBody - Whether the request carries a body; a JSON content type is added when the caller did not set one.
 * @param pluginId - The plugin the request is made for, if any.
 * @returns A new `Headers` object; the input is not modified.
 */
export function buildRequestHeaders(
  headers: HeadersInit | undefined,
  hasBody: boolean,
  pluginId: string | undefined,
): Headers {
  const merged = new Headers(headers)
  if (hasBody && !merged.has('content-type')) merged.set('content-type', 'application/json')
  if (pluginId !== undefined) merged.set('x-wickermoney-plugin', pluginId)
  return merged
}
