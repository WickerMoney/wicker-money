import type { ComponentType } from 'react'
import type { WidgetSize } from './manifest/index.js'
import type { DashboardRange } from './range.js'

/** The authenticated user, as the host knows them. */
export interface PluginSession {
  /** The user's unique id. */
  readonly userId: string
  /** The email address the user signed in with. */
  readonly email: string
  /** The user's IANA time zone name, e.g. `Europe/London`. */
  readonly timezone: string
}

/**
 * Scoped HTTP client handed to a plugin.
 *
 * Requests are relative to the plugin's own namespace (`/api/v1/p/<id>/`) for
 * plugin endpoints, or to core read endpoints the manifest's `requiredTables`
 * permits. The host attaches credentials — a plugin never sees the access
 * token, so it cannot exfiltrate one or call the API as the user elsewhere.
 */
export interface PluginApi {
  /**
   * Sends a `GET` request.
   *
   * @param path - Path relative to the plugin's namespace or a permitted core endpoint.
   * @param init - Extra `fetch` options for this request.
   * @returns The parsed JSON response body.
   */
  get<T>(path: string, init?: RequestInit): Promise<T>
  /**
   * Sends a `POST` request with a JSON body.
   *
   * @param path - Path relative to the plugin's namespace or a permitted core endpoint.
   * @param body - Value serialised as the JSON request body.
   * @param init - Extra `fetch` options for this request.
   * @returns The parsed JSON response body.
   */
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>
  /**
   * Upserts: creates the resource or replaces it if it exists.
   *
   * Present because a plugin editing one row of its own data should be able to
   * say so. A plugin saving a line into a month that may or may not exist yet
   * would otherwise have to invent its own convention for "create or replace"
   * on top of `POST`.
   *
   * @param path - Path relative to the plugin's namespace or a permitted core endpoint.
   * @param body - Value serialised as the JSON request body.
   * @param init - Extra `fetch` options for this request.
   * @returns The parsed JSON response body.
   */
  put<T>(path: string, body: unknown, init?: RequestInit): Promise<T>
  /**
   * Sends a `DELETE` request. Named `del` because `delete` is a reserved word.
   *
   * @param path - Path relative to the plugin's namespace or a permitted core endpoint.
   * @param init - Extra `fetch` options for this request.
   * @returns The parsed JSON response body.
   */
  del<T>(path: string, init?: RequestInit): Promise<T>
}

/**
 * Everything a plugin is given. Injected as a prop — never a global, never a
 * module-scoped singleton, so two plugins cannot observe or corrupt each
 * other's context, and a test can construct one directly.
 */
export interface PluginContext {
  /** The signed-in user. */
  readonly session: PluginSession
  /** Scoped HTTP client for the plugin's own endpoints and the core endpoints its manifest permits. */
  readonly api: PluginApi
  /** Navigates the shell to an in-app path. */
  readonly navigate: (path: string) => void
  /** Formats a numeric-string money value in the user's locale. */
  readonly formatMoney: (value: string, currency?: string) => string
  /** Formats a date string in the user's locale. */
  readonly formatDate: (value: string) => string
}

/** Props the host passes to a plugin page component. */
export interface PluginPageProps {
  /** Everything the plugin is given by the host. */
  readonly ctx: PluginContext
}

/** A React component that renders a full plugin page. */
export type PluginPage = ComponentType<PluginPageProps>

/** Props the host passes to a plugin widget component. */
export interface PluginWidgetProps {
  /** Everything the plugin is given by the host. */
  readonly ctx: PluginContext
  /** The size the widget is being rendered at. */
  readonly size: WidgetSize
  /**
   * The dashboard's current time range.
   *
   * Every widget on the dashboard receives the same one, so two charts side by
   * side cannot be showing different periods while looking comparable — which
   * is the specific way a dashboard misleads. A widget with nothing to scope
   * ignores it.
   *
   * Optional so a widget rendered outside the dashboard (an account detail
   * slot, a test) still typechecks without inventing a range that means
   * nothing there.
   */
  readonly range?: DashboardRange
}

/** A React component that renders a plugin widget. */
export type PluginWidget = ComponentType<PluginWidgetProps>

/**
 * Shape a plugin's federated module must export.
 *
 * `default` keeps the contract obvious at the call site: whatever the module
 * default-exports is the component the host renders.
 */
export interface PluginModule {
  readonly default: PluginPage | PluginWidget
}

/**
 * Adds a plugin's stylesheet to the document.
 *
 * A federated remote has no HTML document of its own, so a side-effect
 * `import './x.css'` goes nowhere: the host loads the remote's JS by dynamic
 * import and nothing ever requests the emitted stylesheet. The result is a
 * widget that mounts, fetches, renders — and looks broken, with every custom
 * property falling back to a default. Nothing errors, which is why it is worth
 * a named helper rather than a comment.
 *
 * Plugins therefore import their CSS as text (`import css from './x.css?inline'`)
 * and call this at module scope. The `<style>` element is keyed by plugin id, so
 * two widgets from the same plugin inject once and a second copy of the SDK
 * inside another remote cannot duplicate it.
 *
 * Scoping is still the plugin's job: keep declarations under a class the plugin
 * owns. This injects into the host document; it is not a style sandbox.
 *
 * Does nothing when there is no `document`, so importing and calling it in a
 * Node process is safe.
 *
 * @param pluginId - The plugin's manifest id, used to key the `<style>` element.
 * @param css - The stylesheet text to inject.
 */
export function adoptPluginStyles(pluginId: string, css: string): void {
  if (typeof document === 'undefined') return
  const id = `wickermoney-plugin-styles:${pluginId}`
  if (document.getElementById(id) !== null) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.append(style)
}
