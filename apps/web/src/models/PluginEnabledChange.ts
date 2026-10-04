import type { RegisteredPlugin } from './RegisteredPlugin.js'

/** The API's answer to switching a plugin on or off. */
export interface PluginEnabledChange {
  /** The plugin as it now is. */
  readonly plugin: RegisteredPlugin
  /** Its state before the request. */
  readonly previous: { readonly enabled: boolean }
  /** Whether the request changed anything. */
  readonly changed: boolean
  /** Who made the request. */
  readonly changedBy: { readonly id: string; readonly email: string }
  /** When, as an ISO timestamp. */
  readonly changedAt: string
}
