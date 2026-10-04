import type { RegisteredPlugin } from './RegisteredPlugin.js'

/** The outcome of switching a plugin on or off. */
export interface EnabledChange {
  /** Whether the plugin was enabled before the change. */
  readonly previous: boolean
  /** The plugin as it is now. */
  readonly plugin: RegisteredPlugin
}
