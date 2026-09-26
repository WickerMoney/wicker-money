/**
 * Decides whether a shape-valid `remoteEntry` may be loaded on this host.
 *
 * A same-origin path is always allowed: it is served by the host itself. An
 * `https:` URL is allowed only when its origin is in `allowedOrigins`, which is
 * empty by default (same-origin only).
 *
 * Run by the host when a manifest is registered, after `parseManifest` has
 * checked the entry's shape.
 *
 * @param remoteEntry - The manifest's `remoteEntry`.
 * @param allowedOrigins - Origins (`https://host[:port]`) that may serve plugin code.
 * @returns `undefined` when the entry may be loaded, otherwise a message saying why not.
 */
export function checkRemoteEntry(
  remoteEntry: string,
  allowedOrigins: readonly string[] = [],
): string | undefined {
  if (remoteEntry.startsWith('/')) return undefined
  let origin: string
  try {
    origin = new URL(remoteEntry).origin
  } catch {
    return `remoteEntry '${remoteEntry}' is not a valid URL`
  }
  if (allowedOrigins.includes(origin)) return undefined
  return `remoteEntry origin '${origin}' is not in the allowed plugin origins (PLUGIN_REMOTE_ORIGINS)`
}
