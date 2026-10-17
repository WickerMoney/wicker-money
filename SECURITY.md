# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

The preferred channel is GitHub private vulnerability reporting: open this
repository's **Security** tab and choose **Report a vulnerability**.

If that is not available, email
[support@wicker.money](mailto:support@wicker.money). This mailbox forwards to the
maintainer.

Include what you found, the version or image tag you tested, and steps to
reproduce. Please leave real financial data, tokens and secrets out of your
report.

## Supported versions

Wicker Money is pre-1.0. Only the latest release is supported. Fixes are not
backported to older versions.

## What to expect

This project has a single maintainer. Reports are handled on a best-effort
basis, and I aim to acknowledge a report within 7 days. That is a target, not a
commitment.

## Scope

In scope:

- The self-hosted app (`apps/api`, `apps/web`)
- The bundled plugins (`plugins/*`)
- The plugin SDK (`@wickermoney/plugin-sdk`) and UI kit (`@wickermoney/ui-kit`)
- The container image (`ghcr.io/wickermoney/wicker-money`)

Particularly interesting, because the design leans on them:

- Anything that lets one user read or modify another user's rows (tenant
  isolation is enforced with PostgreSQL row-level security).
- A way out of the plugin boundary. A UI plugin that runs in the isolated
  runtime is confined to a sandboxed frame and reaches data only through the
  host, with a short-lived token that carries just its manifest's grants. These
  are in scope: reading or changing data outside those grants; obtaining the
  user's session token or refresh cookie; reaching authentication, the data
  export, the erase actions, plugin management or another plugin's routes; and
  getting the host to run a plugin file that does not match its integrity pin, or
  to run a plugin served from another origin inside the app's own page. Plugins
  that still run inside the app's own page are not behind this boundary (see
  "Who runs where").
- A bundled plugin's server-side code reaching a table its manifest never
  requested through its normal query path (guarded by a per-plugin PostgreSQL
  role; see "Things worth knowing" for what that does not cover).
- Authentication, session and refresh-token handling.

Out of scope:

- Deployments that run in production over plain HTTP with `COOKIE_SECURE=false`.
  The app warns about this at startup; put it behind HTTPS instead.
- Instances left with `REGISTRATION_ENABLED=true` on a network you do not
  control. That setting is deliberate and documented. Unless
  `BOOTSTRAP_OWNER_EMAIL` is set, the first account to register on such an
  instance becomes its owner; the variable does not verify the address, so it
  does not stop someone who knows it from registering it first.
- Vulnerabilities in a third-party plugin's own code. The boundary is meant to
  contain such a plugin, and a bug inside it is that author's to fix.
- What an isolated plugin can already read with its grants, and sending that out
  through the channels listed under "Known gaps" below, in the browser version
  named there. The same channel in another browser, or a further channel of the
  same kind, is in scope.

## Things worth knowing

- Financial data is sensitive. Please keep it out of issues, logs and reports.

### Who runs where

| Plugin | Where its UI runs | Trust |
| --- | --- | --- |
| Insights, Spending Trends | A sandboxed frame | Confined to its grants (below) |
| Budgets, Import CSV, Upcoming, Forecast, Debt payoff | **The app's own page** | **Fully trusted, not sandboxed** |
| A third-party plugin an operator has added | A sandboxed frame, always | Confined to its grants (below) |

The bundled plugins in the second row have not been moved into frames yet. Their
front-end code runs in the app's own origin with the signed-in user's access to
the whole API; their manifest's `requiredTables` and the `x-wickermoney-plugin`
header are not a security boundary for that code. They ship in the image and
are reviewed with the rest of the application.

### What the isolated runtime protects

An isolated plugin's UI runs in an `<iframe sandbox="allow-scripts">` whose
document carries its own content security policy. It has no access to the app's
cookies, storage or DOM, and script in the frame cannot make network requests of
its own (`fetch`, XHR, WebSocket and beacons are blocked by the frame's policy;
the browser has a few other ways to send a request, listed under "Known gaps").
Its only way to reach your data is a message channel to the host, which checks
each request against the plugin's grants and forwards it with a plugin-specific
token. The server gives that token nothing but a few read-only aggregate routes
for the tables the manifest lists, and the plugin's own `/p/<id>/` routes. Every
other route, including sign-in, refresh, export, erase and plugin management, is
refused for it. A hostile-plugin test suite attempts about 140 escapes, and a
remote-origin test drives a real build through the integrity pin, in Chromium on
every pull request.

### What it does not protect

- **Server-side plugin code stays first-party.** A plugin's own endpoints,
  scheduled work and exporters run in the API process, and nothing here can
  contain that. They are refused for any plugin that is not in the image. The
  per-plugin PostgreSQL role is a guardrail for the bundled plugins' server code,
  not a sandbox: the query runner reads SQL text, so a crafted statement (a `DO`
  block that builds `RESET ROLE` at run time, for instance) can return to the
  application role and lose the manifest's table limits. Row-level security still
  holds: such a statement reads no other user's rows. A report of that is a known
  limitation, not a vulnerability.
- **A plugin keeps what it is granted.** A plugin can read what its grants allow
  and what the host tells it about the session (the user's email and id). The
  grant, not the sandbox, limits what it can learn.
- **Known gaps** (observed in Chromium 141; WebKitGTK 2.52 was checked for the
  last one only; Firefox and Safari have not been tested). The frame's content
  security policy does not cover every way a browser can send a request. A
  malicious plugin can still cause some requests and read nothing back from them.
  - `<link rel=prerender>` and WebRTC (STUN and TURN) reach an address the plugin
    chooses, and can carry what the plugin holds in the URL or the TURN username.
  - A sandboxed frame can navigate itself to a URL on the app's own origin that
    the page's frame policy allows. In Chromium 141 that request carried none of
    the user's credentials and returned nothing to the plugin. In WebKitGTK 2.52
    the same navigation carried a `SameSite=Strict` cookie. Do not assume either
    result for another browser.

  These are known limitations, not vulnerabilities, until they are closed. A
  report that one of them behaves differently in another browser, or of a further
  channel of the same kind, is in scope and welcome.
- **Newness.** The boundary is new code. The broker and the token path have not
  been through an independent security review.

### Third-party plugins

**Status: experimental.** The isolated runtime and loading a third-party plugin
are opt-in and off by default, and the broker and token path behind them have not
been independently reviewed.

There is no install flow, no catalog and no signing. The only way to add a
third-party plugin is for the operator to do it by hand:

1. Put the plugin's build on an https origin and list that origin in
   `PLUGIN_REMOTE_ORIGINS` (empty by default; with it empty, nothing changes).
2. Copy its manifest, with an `integrity` map of Subresource Integrity values for
   every file of the build, into the directory named by `PLUGIN_MANIFEST_DIR`, and
   restart the API.
3. Switch the plugin on as an owner. It starts off.

A third-party plugin gets no server-side code, no storage and no scheduled work.
It can read only the read-only core aggregates (eight routes) for the tables its
manifest lists.

The integrity pin makes the browser refuse a file whose bytes differ from the
ones you pinned. It covers only the files it lists, not stylesheets, and is only
as good as the place you took the hashes from: take them from the build you
reviewed, not from the server that will serve it. It does not tell you the code
is safe; read it before you pin it. The origin must answer with cross-origin
headers, and listing an origin means trusting it to serve what you pinned and
nothing it chooses later.

Treat a third-party plugin as code you have chosen to run inside a cage that has
known gaps (above), not as code that is safe to run. A plugin that is granted
your transactions can send them to another server through those gaps. If you
would not give it the aggregates it asks for, do not add it.
