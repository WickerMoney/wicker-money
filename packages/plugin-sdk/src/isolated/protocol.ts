import type { WidgetSize } from '../manifest/index.js'
import type { DashboardRange } from '../range.js'

/**
 * Version of the message protocol between the host and a plugin frame.
 *
 * Bumped only for a change an older peer cannot ignore (a changed field, a
 * removed message). Adding a message type is not a bump: each side ignores
 * message types it does not know, so a newer host can talk to an older plugin.
 */
export const ISOLATED_PROTOCOL_VERSION = 1 as const

/**
 * The error codes the host is expected to use. A host may send others (the
 * API's own codes pass through), so `PluginApiError.code` is a plain string;
 * these are the ones a plugin can rely on.
 *
 * - `grant_denied` - the manifest does not grant the table or path.
 * - `invalid_request` - the request was malformed or used an unsupported option.
 * - `not_supported` - the host does not implement the message (for example `notify`).
 * - `network_error` - the host could not reach the API.
 * - `aborted` - the caller aborted the request.
 * - `disconnected` - the connection to the host was closed before an answer came.
 * - `request_failed` - the API answered with an error that carried no code of its own.
 */
export const PLUGIN_ERROR_CODES = [
  'grant_denied',
  'invalid_request',
  'not_supported',
  'network_error',
  'aborted',
  'disconnected',
  'request_failed',
] as const

/** One of the error codes in {@link PLUGIN_ERROR_CODES}. */
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number]

/** One problem with a request, tied to the body field it is about. Same shape as the API's `validation_failed` issues. */
export interface PluginApiIssue {
  /** The field, as the request body spells it; empty for the request as a whole. */
  readonly path: readonly (string | number)[]
  /** A sentence about that field that does not repeat its name. */
  readonly message: string
}

/** The plugin-visible error, as it crosses the channel. The client turns it into a `PluginApiError`. */
export interface PluginErrorPayload {
  /** A code the plugin can branch on; see {@link PLUGIN_ERROR_CODES}. */
  readonly code: string
  /** A sentence safe to show the person. */
  readonly message: string
  /** The HTTP status when the failure came from an API response. */
  readonly status?: number
  /** Field-by-field problems, from a `validation_failed` or a plugin's own 400. */
  readonly issues?: readonly PluginApiIssue[]
}

/** HTTP methods a plugin can ask the host to send. */
export type PluginRequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** The `RequestInit.cache` values the protocol carries. Everything else in `RequestInit` stays in the frame. */
export type PluginRequestCache = 'default' | 'no-store' | 'reload'

/** Which way focus leaves or enters the frame. */
export type FocusDirection = 'next' | 'previous'

/** The colour scheme the host is showing. */
export type ThemeScheme = 'light' | 'dark'

/**
 * The theme the host applies to the frame: the scheme and the design tokens
 * (CSS custom properties, keys starting `--`) the host's stylesheet defines.
 * A frame cannot inherit custom properties from the host page, so the host
 * sends them.
 */
export interface HostTheme {
  /** The active scheme; applied as `data-theme` on the frame's root element. */
  readonly scheme: ThemeScheme
  /** Custom property name (with the leading `--`) to value. */
  readonly tokens: Readonly<Record<string, string>>
}

/** The signed-in user, as the plugin may see them. The same three fields as `PluginSession`. */
export interface HostSession {
  readonly userId: string
  readonly email: string
  readonly timezone: string
}

/** How the host formats numbers and dates for this person. */
export interface HostLocale {
  /** A BCP 47 tag such as `en-US`. */
  readonly locale: string
  /** An IANA time zone name such as `Europe/London`. */
  readonly timezone: string
}

// ---------------------------------------------------------------------------
// Window handshake: the only traffic that is not on the MessagePort.
// ---------------------------------------------------------------------------

/**
 * Frame to host, via `window.parent.postMessage`: "I am loaded; these are the
 * protocol versions I speak." Carries nothing secret. The host identifies the
 * sender by `event.source` (the frame's `contentWindow`), never by
 * `event.origin`, which is `"null"` for a sandboxed frame.
 */
export interface FrameHello {
  readonly type: 'wm.hello'
  readonly protocols: readonly number[]
}

/**
 * Host to frame, via `frame.contentWindow.postMessage` with one `MessagePort`
 * transferred: "use this version, over this port." All later traffic is on that
 * port, which only this frame and the host hold.
 */
export interface HostConnect {
  readonly type: 'wm.connect'
  readonly protocol: number
}

/** Host to frame: no common protocol version. The frame should show an error and stop. */
export interface HostRefuse {
  readonly type: 'wm.refuse'
  readonly supported: readonly number[]
}

// ---------------------------------------------------------------------------
// Frame to host, on the port.
// ---------------------------------------------------------------------------

/** The frame has the port and is listening; the host answers with {@link InitMessage}. */
export interface ReadyMessage {
  readonly type: 'ready'
  readonly protocol: number
}

/**
 * An API call. `path` is relative to the API root, exactly as for `ctx.api`.
 * The host checks it against the manifest's grants and performs it with its own
 * credentials; the frame never holds a token. `id` is chosen by the frame and
 * echoed in the response.
 */
export interface RequestMessage {
  readonly type: 'request'
  readonly id: number
  readonly method: PluginRequestMethod
  readonly path: string
  /** JSON body for `POST` and `PUT`. */
  readonly body?: unknown
  readonly cache?: PluginRequestCache
}

/** The caller aborted request `id`. The host drops the answer and may abort the call. */
export interface CancelMessage {
  readonly type: 'cancel'
  readonly id: number
}

/** Navigate the shell to an in-app path. For a page frame this also keeps the address bar in step. */
export interface NavigateMessage {
  readonly type: 'navigate'
  readonly path: string
}

/**
 * The frame's content height in CSS pixels. The host owns width. It sets the
 * frame height from this, within its own minimum and maximum.
 */
export interface ResizeMessage {
  readonly type: 'resize'
  readonly height: number
}

/** Focus has left the frame's last (`next`) or first (`previous`) focusable element; the host moves it on. */
export interface FocusOutMessage {
  readonly type: 'focus-out'
  readonly direction: FocusDirection
}

/**
 * Reserved for the `notify` permission, which no host implements yet. A host
 * answers with a `not_supported` error response. The message exists so the
 * protocol does not change when `notify` is built.
 */
export interface NotifyMessage {
  readonly type: 'notify'
  readonly id: number
  readonly level: 'info' | 'success' | 'warning' | 'error'
  readonly message: string
}

/** Every message a plugin frame may send on the port. */
export type PluginMessage =
  | ReadyMessage
  | RequestMessage
  | CancelMessage
  | NavigateMessage
  | ResizeMessage
  | FocusOutMessage
  | NotifyMessage

// ---------------------------------------------------------------------------
// Host to frame, on the port.
// ---------------------------------------------------------------------------

/** What the frame is: a dashboard widget or a full page. */
export type FrameKind = 'widget' | 'page'

/** First message from the host; everything the frame needs to render. */
export interface InitMessage {
  readonly type: 'init'
  readonly protocol: number
  /** The plugin's manifest id. */
  readonly pluginId: string
  readonly kind: FrameKind
  readonly session: HostSession
  readonly locale: HostLocale
  readonly theme: HostTheme
  /** Widgets only: the size the widget is rendered at. */
  readonly size?: WidgetSize
  /** Widgets only: the dashboard's current range, when there is one. */
  readonly range?: DashboardRange
  /** Pages only: the path under the page's own route to render first. Starts with `/`. */
  readonly path?: string
}

/** The answer to a {@link RequestMessage} or {@link NotifyMessage}. */
export type ResponseMessage =
  | { readonly type: 'response'; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly type: 'response'; readonly id: number; readonly ok: false; readonly error: PluginErrorPayload }

/** The scheme or tokens changed (the person switched theme, or the system did). */
export interface ThemeMessage {
  readonly type: 'theme'
  readonly theme: HostTheme
}

/** The locale or time zone changed. */
export interface LocaleMessage {
  readonly type: 'locale'
  readonly locale: HostLocale
}

/** A widget's size or the dashboard range changed. Either field may be absent when it did not change. */
export interface PropsMessage {
  readonly type: 'props'
  readonly size?: WidgetSize
  readonly range?: DashboardRange
}

/** Pages only: the route under the page changed from outside (browser back, a link). */
export interface RouteMessage {
  readonly type: 'route'
  readonly path: string
}

/** Move focus into the frame, to its first or last focusable element. */
export interface FocusInMessage {
  readonly type: 'focus-in'
  readonly direction: 'first' | 'last'
}

/** Every message the host may send on the port. */
export type HostMessage =
  | InitMessage
  | ResponseMessage
  | ThemeMessage
  | LocaleMessage
  | PropsMessage
  | RouteMessage
  | FocusInMessage
