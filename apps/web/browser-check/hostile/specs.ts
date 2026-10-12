/**
 * The attempts that the browser or the frame document's policy must stop, as data.
 *
 * Each entry names a function on the fixture (`fixture/Hostile.tsx`), the markers the fixture puts on the URLs
 * it builds (`hx=<marker>`), and a pattern for the reason the browser gives. The runner calls the function in the
 * hostile frame and then asks the things the plugin cannot fake: did the attacker's server receive anything with
 * that marker, did the API, and what did the browser log.
 */
export interface BlockSpec {
  readonly id: string
  readonly group: 'network' | 'forms' | 'navigation' | 'windows' | 'script'
  readonly title: string
  readonly call: string
  readonly args?: readonly unknown[]
  /** Markers on URLs aimed at the attacker's origin. Nothing with one may arrive. */
  readonly attacker?: readonly string[]
  /** Markers on URLs aimed at the app's own API. Nothing with one may reach the server. */
  readonly host?: readonly string[]
  /** The mechanism the browser must name, in a CSP violation, an exception or a console message. */
  readonly reason: RegExp
  /**
   * The attempt is aimed at the app's own origin through a channel the frame's policy deliberately allows (script-src and
   * style-src name the app's origin, because that is where plugin bundles load from). The request may arrive; it must
   * arrive anonymous (no bearer, no cookie) and be refused, and the browser must refuse to hand the response to the frame.
   */
  readonly anonymousOnly?: boolean
  /** Windows the attempt must not have opened. Counted against the context's pages. */
  readonly noNewPages?: boolean
}

const CONNECT = /connect-src/
const FRAME = /frame-src|child-src|default-src|Refused to frame/
const SANDBOX_NAV = /allow-top-navigation|Unsafe attempt to initiate navigation|sandboxed/i

export const BLOCKED: readonly BlockSpec[] = [
  // ---- The network, from script in the frame. Connect-src is 'none'.
  { id: 'fetch-refresh', group: 'network', title: 'POST /api/v1/auth/refresh with credentials and the CSRF header', call: 'fetchRefresh', host: ['fetch-refresh'], reason: CONNECT },
  { id: 'fetch-export', group: 'network', title: 'GET /api/v1/settings/export with credentials', call: 'fetchExport', host: ['fetch-export'], reason: CONNECT },
  { id: 'fetch-host-nocors', group: 'network', title: 'no-cors fetch of the host API', call: 'fetchHostApiNoCors', host: ['fetch-host-nocors'], reason: CONNECT },
  { id: 'fetch-attacker', group: 'network', title: 'fetch to another origin, carrying the session email', call: 'fetchAttacker', attacker: ['fetch-attacker'], reason: CONNECT },
  { id: 'fetch-keepalive', group: 'network', title: 'keepalive POST to another origin', call: 'fetchAttackerKeepalive', attacker: ['fetch-keepalive'], reason: CONNECT },
  { id: 'xhr-export', group: 'network', title: 'XMLHttpRequest to /api/v1/settings/export', call: 'xhrExport', host: ['xhr-export'], reason: CONNECT },
  { id: 'xhr-attacker', group: 'network', title: 'XMLHttpRequest to another origin', call: 'xhrAttacker', attacker: ['xhr-attacker'], reason: CONNECT },
  { id: 'ws-attacker', group: 'network', title: 'WebSocket to another origin', call: 'webSocketAttacker', attacker: ['ws-attacker'], reason: CONNECT },
  { id: 'ws-host', group: 'network', title: 'WebSocket to the app', call: 'webSocketHost', host: ['ws-host'], reason: CONNECT },
  { id: 'beacon-attacker', group: 'network', title: 'navigator.sendBeacon to another origin', call: 'beaconAttacker', attacker: ['beacon-attacker'], reason: CONNECT },
  { id: 'beacon-host-refresh', group: 'network', title: 'navigator.sendBeacon to /api/v1/auth/refresh', call: 'beaconHostRefresh', host: ['beacon-host-refresh'], reason: CONNECT },
  { id: 'eventsource-attacker', group: 'network', title: 'EventSource to another origin', call: 'eventSourceAttacker', attacker: ['eventsource-attacker'], reason: CONNECT },
  { id: 'image-attacker', group: 'network', title: 'image beacon to another origin', call: 'imageAttacker', attacker: ['image-attacker'], reason: /img-src|default-src/ },
  { id: 'image-host', group: 'network', title: 'image load of a host API URL', call: 'imageHost', host: ['image-host'], reason: /img-src|default-src/ },
  { id: 'css-url', group: 'network', title: 'CSS url() and @import to another origin', call: 'cssUrlAttacker', attacker: ['css-attacker', 'css-import'], reason: /img-src|style-src|default-src/ },
  { id: 'stylesheet-attacker', group: 'network', title: '<link rel=stylesheet> to another origin', call: 'stylesheetAttacker', attacker: ['stylesheet-attacker'], reason: /style-src/ },
  { id: 'font-attacker', group: 'network', title: 'web font from another origin', call: 'fontAttacker', attacker: ['font-attacker'], reason: /font-src|default-src/ },
  { id: 'media-attacker', group: 'network', title: 'audio element pointed at another origin', call: 'mediaAttacker', attacker: ['media-attacker'], reason: /media-src|default-src/ },
  { id: 'iframe-attacker', group: 'network', title: 'nested iframe to another origin', call: 'iframeAttacker', attacker: ['iframe-attacker'], reason: FRAME },
  { id: 'iframe-host', group: 'network', title: 'nested iframe of a host API URL', call: 'iframeHostApi', host: ['iframe-host'], reason: FRAME },
  { id: 'object-attacker', group: 'network', title: '<object> to another origin', call: 'objectAttacker', attacker: ['object-attacker'], reason: /object-src|default-src|frame-src/ },
  { id: 'embed-attacker', group: 'network', title: '<embed> to another origin', call: 'embedAttacker', attacker: ['embed-attacker'], reason: /object-src|default-src|frame-src/ },
  { id: 'worker-attacker', group: 'network', title: 'Worker script from another origin', call: 'workerAttacker', attacker: ['worker-attacker'], reason: /worker-src|child-src|script-src|default-src|SecurityError/ },
  { id: 'worker-blob', group: 'network', title: 'Worker from a blob that fetches another origin', call: 'workerBlob', attacker: ['worker-blob-fetch'], reason: /worker-src|child-src|script-src|default-src/ },

  // ---- Code the plugin tries to add to its own frame.
  { id: 'script-attacker', group: 'script', title: '<script src> from another origin', call: 'scriptAttacker', attacker: ['script-attacker'], reason: /script-src/ },
  { id: 'script-host-export', group: 'script', title: '<script src> pointed at the export route', call: 'scriptTagHostApi', host: ['script-host-export'], anonymousOnly: true, reason: /ERR_BLOCKED_BY_RESPONSE|ORB|CORB|script-src/ },
  { id: 'import-attacker', group: 'script', title: 'dynamic import() from another origin', call: 'importAttacker', attacker: ['import-attacker'], reason: /script-src|Failed to fetch dynamically imported module/ },
  { id: 'eval', group: 'script', title: 'eval()', call: 'evalCode', reason: /unsafe-eval|script-src/ },
  { id: 'new-function', group: 'script', title: 'new Function()', call: 'newFunction', reason: /unsafe-eval|script-src/ },
  { id: 'inline-script', group: 'script', title: 'inline <script> that fetches another origin', call: 'inlineScript', attacker: ['inline-script'], reason: /script-src|inline/ },
  { id: 'inline-handler', group: 'script', title: 'onerror attribute handler that fetches another origin', call: 'inlineHandler', attacker: ['inline-handler'], reason: /script-src|inline/ },
  { id: 'base-tag', group: 'script', title: '<base href> to another origin, then a relative image', call: 'baseTagRedirect', attacker: ['base-tag'], reason: /base-uri/ },

  // ---- Forms.
  { id: 'form-self', group: 'forms', title: 'form POST to another origin, target _self', call: 'formAttackerSelf', attacker: ['form-attacker-self'], reason: /allow-forms|form-action|sandbox/i },
  { id: 'form-blank', group: 'forms', title: 'form POST to another origin, target _blank', call: 'formAttackerBlank', attacker: ['form-attacker-blank'], reason: /allow-forms|form-action|sandbox/i, noNewPages: true },
  { id: 'form-top', group: 'forms', title: 'form POST to another origin, target _top', call: 'formAttackerTop', attacker: ['form-attacker-top'], reason: /allow-forms|form-action|sandbox/i },
  { id: 'form-host-refresh', group: 'forms', title: 'form POST to /api/v1/auth/refresh', call: 'formHostRefresh', host: ['form-host-refresh'], reason: /allow-forms|form-action|sandbox/i },

  // ---- Navigation.
  { id: 'top-nav-attacker', group: 'navigation', title: 'top.location = another origin, with the session email in the URL', call: 'topNavAttacker', attacker: ['top-nav-attacker'], reason: SANDBOX_NAV },
  { id: 'top-nav-host', group: 'navigation', title: 'top.location = a host API URL', call: 'topNavHostApi', host: ['top-nav-host'], reason: SANDBOX_NAV },
  { id: 'parent-location', group: 'navigation', title: 'parent.location.replace(another origin)', call: 'parentLocationAttacker', attacker: ['parent-location-attacker'], reason: SANDBOX_NAV },
  { id: 'anchor-top', group: 'navigation', title: '<a target=_top> click', call: 'anchorTop', attacker: ['anchor-top'], reason: SANDBOX_NAV },
  { id: 'anchor-parent', group: 'navigation', title: '<a target=_parent> click', call: 'anchorParent', attacker: ['anchor-parent'], reason: SANDBOX_NAV },
  { id: 'meta-refresh', group: 'navigation', title: '<meta http-equiv=refresh> to another origin', call: 'metaRefreshAttacker', attacker: ['meta-refresh-attacker'], reason: FRAME },
  { id: 'sibling-navigation', group: 'navigation', title: 'navigate a sibling frame to another origin', call: 'siblingNavigation', attacker: ['sibling-navigation'], reason: SANDBOX_NAV },
  { id: 'self-nav-attacker', group: 'navigation', title: 'location = another origin (the frame navigates itself)', call: 'selfNavAttacker', attacker: ['self-nav-attacker'], reason: FRAME },

  // ---- Windows and popups.
  { id: 'window-open', group: 'windows', title: 'window.open(another origin)', call: 'windowOpenAttacker', attacker: ['window-open-attacker'], reason: /popup|sandbox|allow-popups/i, noNewPages: true },
  { id: 'window-open-named', group: 'windows', title: 'window.open(another origin, "evil", "noopener")', call: 'windowOpenNamed', attacker: ['window-open-named'], reason: /popup|sandbox|allow-popups/i, noNewPages: true },
  { id: 'window-open-blank', group: 'windows', title: 'window.open("about:blank") to script a window of its own', call: 'windowOpenBlank', reason: /popup|sandbox|allow-popups/i, noNewPages: true },
  { id: 'anchor-blank', group: 'windows', title: '<a target=_blank> click', call: 'anchorBlank', attacker: ['anchor-blank'], reason: /popup|sandbox|allow-popups/i, noNewPages: true },
  { id: 'anchor-ping', group: 'windows', title: '<a ping=...> click', call: 'anchorPing', attacker: ['anchor-ping'], reason: /connect-src|ping|sandbox/i },
]
