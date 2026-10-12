/**
 * Whether a manifest's `remoteEntry` is served by this host itself.
 *
 * Only a path under `/plugins/` is: the host's own web server hands it out, from
 * the image's build output. An `https:` URL names another origin, which the host
 * does not control, whatever the operator has allowlisted.
 *
 * This is one of the two things the in-realm runtime requires (the other is
 * that the plugin shipped in the image), and the reason a remote entry has no
 * in-realm path at all: script from another origin may run only in a sandboxed
 * frame, pinned to the bytes the operator reviewed.
 *
 * @param remoteEntry - A validated manifest's `remoteEntry`.
 * @returns `true` for a same-origin path, `false` for anything else.
 */
export function isHostServedEntry(remoteEntry: string): boolean {
  return remoteEntry.startsWith('/') && !remoteEntry.startsWith('//')
}
