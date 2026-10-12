/**
 * Decides whether a manifest's `integrity` pin is complete enough for a host to
 * load its `remoteEntry`.
 *
 * A pin is a map from file to hash, and the host verifies each listed file
 * before it is loaded (the browser checks it against the bytes it fetched). That
 * only protects the entry if the entry is listed, so the entry's own file name
 * must be a key. It also must be addressable by a path: an entry with a query
 * string or a fragment could be fetched under a URL no key can name.
 *
 * Whether a manifest *needs* a pin is host policy, not manifest shape: a host
 * requires one for every plugin it did not ship and for every entry that is not
 * served by the host itself. Run this after `parseManifest` has checked the
 * shapes, and only for a manifest the host requires a pin for.
 *
 * Files the entry loads that are not listed are not verified. List every file of
 * the build to pin the whole plugin; see the plugin README for what a pin covers.
 *
 * @param remoteEntry - The manifest's `remoteEntry`.
 * @param integrity - The manifest's `integrity` map, if it has one.
 * @returns `undefined` when the pin can be used, otherwise a message saying why not.
 * @example
 * checkRemoteEntryIntegrity('/plugins/acme/remoteEntry.js', undefined)
 * // "remoteEntry '/plugins/acme/remoteEntry.js' has no integrity pin ..."
 */
export function checkRemoteEntryIntegrity(
  remoteEntry: string,
  integrity: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (integrity === undefined || Object.keys(integrity).length === 0) {
    return `remoteEntry '${remoteEntry}' has no integrity pin: list the entry file and the files it loads under "integrity" as sha384 Subresource Integrity values`
  }
  let path: string
  try {
    const url = new URL(remoteEntry, 'https://plugins.invalid')
    if (url.search !== '' || url.hash !== '') return `remoteEntry '${remoteEntry}' must not have a query string or a fragment when it is pinned`
    path = url.pathname
  } catch {
    return `remoteEntry '${remoteEntry}' is not a valid URL`
  }
  const file = path.slice(path.lastIndexOf('/') + 1)
  // An own-property test: `'constructor' in {}` is true, and a file may be called that.
  if (file === '' || !Object.hasOwn(integrity, file)) {
    return `the integrity pin does not list the entry file '${file}', so a changed entry would still load`
  }
  return undefined
}
