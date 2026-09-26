import { SDK_MAJOR_VERSION } from './SDK_MAJOR_VERSION.js'
import { isCompatible } from './isCompatible.js'
import type { ManifestParseResult } from './ManifestParseResult.js'
import { pluginManifestSchema } from './pluginManifestSchema.js'

/**
 * Validates an untrusted manifest.
 *
 * Manifests arrive from the database and, later, from third-party packages, so
 * they are parsed rather than cast. A malformed one is a load failure for that
 * plugin alone, never a crash of the host.
 *
 * @param input - The raw manifest value to validate.
 * @returns The validated manifest, or an `error` message when the shape is
 * invalid (issues joined as `path: message`, separated by `; `) or the
 * manifest was built against a newer SDK major than the host's.
 */
export function parseManifest(input: unknown): ManifestParseResult {
  const parsed = pluginManifestSchema.safeParse(input)
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }
  }
  if (!isCompatible(parsed.data.sdkVersion)) {
    return {
      error:
        `built against SDK v${parsed.data.sdkVersion}, host is v${SDK_MAJOR_VERSION} — ` +
        `upgrade the host to load this plugin`,
    }
  }
  return { manifest: parsed.data }
}
