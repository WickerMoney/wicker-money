import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExternalPlugin } from './service/ExternalPlugin.js'

/** The most manifest files read from the directory. A bound against a mount that is not what it was meant to be. */
export const MAX_MANIFEST_FILES = 100

/** The largest manifest file read, in bytes. A manifest is a few kilobytes; a pin for a large build is the most it holds. */
export const MAX_MANIFEST_BYTES = 256 * 1024

/** What a plugin id must look like. The same shape the manifest schema requires, repeated so a bad id never reaches the registry. */
const PLUGIN_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/

/** What reading the directory found. */
export interface ManifestDirectoryResult {
  /** The manifests to hand to the registry, in file name order. They are not validated yet. */
  readonly plugins: readonly ExternalPlugin[]
  /** One line per file or directory problem, for the boot log. A problem never stops the others from loading. */
  readonly problems: readonly string[]
}

/**
 * Reads the operator's third-party manifests: every `*.json` file directly
 * inside `directory`.
 *
 * This is the whole of the manifest source. There is no install flow, no
 * catalog and nothing that fetches a manifest or a plugin: an operator copies a
 * manifest here (with its integrity pin) and restarts the API. It runs once, at
 * boot, so the set of plugins cannot change while the process runs.
 *
 * Deliberately narrow about what it reads: regular files only (a symlink could
 * point outside the directory), `.json` names only, at most
 * {@link MAX_MANIFEST_FILES} files of at most {@link MAX_MANIFEST_BYTES} bytes,
 * and only a file whose JSON is an object with a well-formed `id`. It checks
 * nothing else: `PluginService` validates each manifest with `parseManifest` and
 * applies the admission rules, so a manifest that is refused is listed with the
 * reason instead of disappearing here.
 *
 * An `id` already used by a bundled plugin, or by an earlier file, is dropped
 * with a problem: a third-party manifest never replaces a bundled one.
 *
 * @param directory - The directory to read, from `PLUGIN_MANIFEST_DIR`.
 * @param bundledIds - Ids of the bundled plugins, which a manifest here may not reuse.
 * @returns The manifests and what went wrong, never throwing for a bad file or directory.
 * @example
 * const { plugins, problems } = readManifestDirectory('/data/plugin-manifests', new Set(['wickermoney.budgets']))
 */
export function readManifestDirectory(directory: string, bundledIds: ReadonlySet<string>): ManifestDirectoryResult {
  const plugins: ExternalPlugin[] = []
  const problems: string[] = []

  let names: string[]
  try {
    if (!lstatSync(directory).isDirectory()) throw new Error('not a directory')
    names = readdirSync(directory).filter((name) => name.endsWith('.json')).sort()
  } catch (error) {
    problems.push(`cannot read PLUGIN_MANIFEST_DIR '${directory}': ${error instanceof Error ? error.message : 'unknown error'}`)
    return { plugins, problems }
  }
  if (names.length > MAX_MANIFEST_FILES) {
    problems.push(`PLUGIN_MANIFEST_DIR holds ${names.length} manifest files; only the first ${MAX_MANIFEST_FILES} are read`)
    names = names.slice(0, MAX_MANIFEST_FILES)
  }

  const claimed = new Map<string, string>()
  for (const name of names) {
    const path = join(directory, name)
    let text: string
    try {
      const stat = lstatSync(path)
      if (!stat.isFile()) {
        problems.push(`${name}: skipped, not a regular file (a symbolic link or a directory is not followed)`)
        continue
      }
      if (stat.size > MAX_MANIFEST_BYTES) {
        problems.push(`${name}: skipped, ${stat.size} bytes is over the ${MAX_MANIFEST_BYTES} byte limit`)
        continue
      }
      text = readFileSync(path, 'utf8')
    } catch (error) {
      problems.push(`${name}: skipped, could not be read (${error instanceof Error ? error.message : 'unknown error'})`)
      continue
    }

    let manifest: unknown
    try {
      manifest = JSON.parse(text)
    } catch (error) {
      problems.push(`${name}: skipped, not valid JSON (${error instanceof Error ? error.message : 'parse error'})`)
      continue
    }
    const id = typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest) ? (manifest as { id?: unknown }).id : undefined
    if (typeof id !== 'string' || id.length > 100 || !PLUGIN_ID.test(id)) {
      problems.push(`${name}: skipped, it has no well-formed "id" (reverse-domain, such as acme.report)`)
      continue
    }
    if (bundledIds.has(id)) {
      problems.push(`${name}: skipped, '${id}' is a bundled plugin and a manifest in this directory cannot replace it`)
      continue
    }
    const earlier = claimed.get(id)
    if (earlier !== undefined) {
      problems.push(`${name}: skipped, '${id}' is already declared by ${earlier}`)
      continue
    }
    claimed.set(id, name)
    plugins.push({ source: name, manifest })
  }
  return { plugins, problems }
}
