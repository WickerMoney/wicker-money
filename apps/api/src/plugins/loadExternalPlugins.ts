import { BUNDLED_PLUGINS } from './bundled.js'
import { readManifestDirectory } from './manifestDirectory.js'
import type { ExternalPlugin } from './service/ExternalPlugin.js'

/** Where {@link loadExternalPlugins} reports what it found. */
export interface ExternalPluginLog {
  info(message: string): void
  warn(message: string): void
}

/**
 * Reads the operator's third-party manifests for startup, and says what it found.
 *
 * Returns nothing and logs nothing when `directory` is unset, so an instance
 * that does not use the setting starts exactly as it did before it existed.
 * When it is set, every plugin found and every file skipped is logged once, so
 * the operator can see what the API will offer an owner to enable.
 *
 * @param directory - `PLUGIN_MANIFEST_DIR`.
 * @param log - Where to report; `console` at startup.
 * @returns The manifests to register.
 */
export function loadExternalPlugins(directory: string | undefined, log: ExternalPluginLog): readonly ExternalPlugin[] {
  if (directory === undefined) return []
  const { plugins, problems } = readManifestDirectory(directory, new Set(BUNDLED_PLUGINS.map((m) => m.id)))
  for (const problem of problems) log.warn(`Third-party plugin manifests: ${problem}`)
  const ids = plugins.map((p) => (p.manifest as { id: string }).id)
  log.info(
    ids.length === 0
      ? `Third-party plugin manifests: none found in ${directory}.`
      : `Third-party plugin manifests: ${ids.length} found in ${directory} (${ids.join(', ')}). ` +
        'They are registered switched off; an owner enables each from the plugin list.',
  )
  return plugins
}
