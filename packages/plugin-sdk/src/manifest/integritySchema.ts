import { z } from 'zod'

/**
 * One Subresource Integrity value: a single hash, `sha256-`, `sha384-` or `sha512-`
 * followed by the standard base64 of the digest at its exact length.
 *
 * Several hashes in one value, option suffixes (`?foo`) and the URL-safe base64
 * alphabet are refused: browsers accept them, but a pin this strict is easy to
 * state, to generate and to compare, and a host never needs the looser forms.
 */
export const SRI_VALUE = /^(?:sha256-[A-Za-z0-9+/]{43}=|sha384-[A-Za-z0-9+/]{64}|sha512-[A-Za-z0-9+/]{86}==)$/

/**
 * A file path relative to the directory of the plugin's `remoteEntry`: plain
 * segments joined by `/`, each starting with a letter, digit or underscore (bundlers name virtual
 * modules `_virtual_...`). That keeps out
 * `..`, a leading `/`, backslashes, percent-encoding, query strings and empty
 * segments, so a key always names a file inside the plugin's own directory.
 */
export const PINNED_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/

/** The most files one pin may list. A federated build is tens of files; this is a bound, not a target. */
export const MAX_PINNED_FILES = 500

/**
 * Validates the shape of a manifest's `integrity` map: file path to SRI value.
 *
 * Shape only. Whether the entry file itself is in the map is checked by
 * `checkRemoteEntryIntegrity`, because it depends on `remoteEntry`.
 */
export const integritySchema = z
  .record(
    z.string().max(200).regex(PINNED_PATH, 'Must be a plain path relative to the remoteEntry directory, such as assets/chunk-1a2b3c.js'),
    z.string().regex(SRI_VALUE, 'Must be one sha256-, sha384- or sha512- Subresource Integrity value (standard base64)'),
  )
  .refine((map) => Object.keys(map).length <= MAX_PINNED_FILES, `At most ${MAX_PINNED_FILES} files can be pinned`)
