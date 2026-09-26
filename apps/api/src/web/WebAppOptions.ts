/** Options for {@link registerWebApp}. */
export interface WebAppOptions {
  /** Directory holding the built web app, i.e. `apps/web/dist` with the plugin remotes under `plugins/`. */
  readonly root: string
  /** `https` origins allowed to serve plugin code, from `PLUGIN_REMOTE_ORIGINS`. */
  readonly pluginOrigins: readonly string[]
}
