/**
 * @module
 * The runtime contract for **isolated** UI plugins: plugins that run in a
 * sandboxed frame with no access to the host page, its cookies or its tokens,
 * and talk to the host only through the messages defined here.
 *
 * Why a separate contract: `PluginContext` is an object of functions, and a
 * function cannot cross a frame boundary. This entry point replaces it with a
 * serialisable message protocol over a `MessagePort`, plus a small client
 * ({@link connectToHost}) that rebuilds the same `PluginContext` inside the
 * frame, so a component written against `@wickermoney/plugin-sdk/runtime` can
 * run in either place.
 *
 * What is here:
 * - the protocol: message types, error shape, version ({@link ISOLATED_PROTOCOL_VERSION});
 * - validators the host runs on everything a frame sends ({@link parsePluginMessage});
 * - the in-frame client ({@link connectToHost}, {@link connectOverPort}), {@link PluginApiError}
 *   and {@link applyHostTheme}.
 *
 * What is not here: the host side (frame element, broker, headers). That ships
 * with the web app, not the SDK.
 *
 * Decisions recorded by this entry point:
 * - **Additive.** Existing manifests and `/runtime` are unchanged, and
 *   `SDK_MAJOR_VERSION` stays `0`. A manifest opts in with `isolated: true`.
 * - **No host-rendered dialogs in protocol 1.** A widget frame is small and
 *   clips overlays; a widget that needs a dialog should `navigate` to its page,
 *   whose frame is full height and can show dialogs itself. Adding a dialog
 *   message later is not a protocol bump (unknown messages are ignored).
 * - **`notify` is reserved.** The message exists and a host answers it with
 *   `not_supported` until the permission is built.
 * - **`RequestInit` is narrowed** to `signal` and `cache`. Headers and
 *   credentials are the host's to set, never the frame's.
 *
 * Stability: `@experimental`. May change in any pre-1.0 minor release until the
 * isolation work has shipped and settled.
 *
 * @experimental
 */
export { connectOverPort, connectToHost } from './client.js'
export type {
  ConnectOptions,
  HandshakeEvent,
  HandshakeWindow,
  HostChange,
  HostConnection,
  IsolatedState,
  ObservedElement,
  ResizeObserverCtor,
} from './client.js'
export { PluginApiError } from './PluginApiError.js'
export { ISOLATED_PROTOCOL_VERSION, PLUGIN_ERROR_CODES } from './protocol.js'
export type {
  CancelMessage,
  FocusDirection,
  FocusInMessage,
  FocusOutMessage,
  FrameHello,
  FrameKind,
  HostConnect,
  HostLocale,
  HostMessage,
  HostRefuse,
  HostSession,
  HostTheme,
  InitMessage,
  LocaleMessage,
  NavigateMessage,
  NotifyMessage,
  PluginApiIssue,
  PluginErrorCode,
  PluginErrorPayload,
  PluginMessage,
  PluginRequestCache,
  PluginRequestMethod,
  PropsMessage,
  ReadyMessage,
  RequestMessage,
  ResizeMessage,
  ResponseMessage,
  RouteMessage,
  ThemeMessage,
  ThemeScheme,
} from './protocol.js'
export { applyHostTheme } from './theme.js'
export type { ThemeTarget } from './theme.js'
export {
  MAX_NOTIFY_LENGTH, MAX_PATH_LENGTH, MAX_REPORTED_HEIGHT, MAX_THEME_TOKENS,
  parseFrameHello, parseHostMessage, parseHostReply, parsePluginMessage,
} from './validate.js'
