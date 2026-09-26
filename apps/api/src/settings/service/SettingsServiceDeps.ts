import type { Config } from '../../config.js'
import type { PluginService } from '../../plugins/service/PluginService.js'
import type { PluginExporter } from './PluginExporter.js'

/** Collaborators of {@link SettingsService} beyond the unit of work. */
export interface SettingsServiceDeps {
  /** The validated application configuration. */
  readonly config: Config
  /** The plugin registry, to find which plugins are enabled. */
  readonly plugins: PluginService
  /** Exporters by plugin id. Defaults to the bundled plugins' exporters. */
  readonly exporters?: Readonly<Record<string, PluginExporter>>
}
