/**
 * The staged CSV upload under attack (ADR 0005, stage 4; release 0.8.0).
 *
 * `run.ts` calls `runStaging` as one phase. The routes under test are Import CSV's `/upload/begin`, `/upload/chunk`,
 * `/upload/finish` and `/upload/abort`, and `analyze` / `commit` by `uploadId`: a file too large for one broker
 * message goes up in chunks and sits in the API's memory until it is imported. Everything is judged from what the
 * server and the broker answer, never from a plugin's account of itself.
 *
 * Two halves:
 *
 *  - The server, over HTTP, with the tokens a frame could hold or a thief could take: a token for another plugin,
 *    another user's upload id by every means, a chunk over the caps, and a flood of `begin` (strict import bucket)
 *    next to chunks (general bucket). It runs against its own API instance, with Import CSV registered, so the
 *    phase does not depend on which plugins `run.ts` happens to mount.
 *  - The broker, in the browser, through the hostile frame's raw port: what a frame cannot send to Import CSV's
 *    routes, the 256 KiB body cap on a chunk-shaped message, a flood of `begin`- and `chunk`-shaped messages with
 *    the page still answering, and the planned uploader's own traffic (6 in flight, about 200,000 characters a
 *    chunk, 36 chunks) staying inside the broker's limits.
 *
 * The real uploader is part of the Import CSV frame, which ports separately, so the 100,000-row flow through a real
 * frame is `importCsv.ts`'s to check; this phase tests the protocol.
 */
import type { AddressInfo } from 'node:net'
import type * as Playwright from 'playwright-core'
import { buildApp } from '../../../api/src/app.js'
import { loadConfig } from '../../../api/src/config.js'
import { KyselyUnitOfWork } from '../../../api/src/data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../../../api/src/db/configureTenantContext.js'
import { createDb } from '../../../api/src/db/client.js'
import { BUNDLED_PLUGINS } from '../../../api/src/plugins/bundled.js'
import { PluginService } from '../../../api/src/plugins/service/PluginService.js'
import { HOSTILE_PLUGIN_ID, hostileManifest } from '../../../api/src/testing/hostilePlugin.js'
import { TEST_AUTH_SECRET, TEST_DATABASE_URL } from '../../../api/src/testing/harness.js'
import type { ApiLog, AttackResult, Recorder } from './lib.js'
import { sleep } from './lib.js'

type Json = Record<string, unknown>

const IMPORT_PLUGIN = 'wickermoney.import-csv'
const UPLOAD = `/api/v1/p/${IMPORT_PLUGIN}`
const ZERO_UUID = '00000000-0000-4000-8000-000000000000'
/** The broker's cap on a serialised request body (`DEFAULT_BROKER_LIMITS.maxBodyBytes`). */
const BROKER_BODY_BYTES = 256 * 1024
const MAPPING = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}

/** What the phase needs from `run.ts`, so this file does not import it (it starts the suite when imported). */
export interface StagingContext {
  /** The shared world; its `page`, `hostile` and `victim` are replaced by every `boot`, so they are read when used. */
  readonly world: {
    readonly base: string
    readonly apiLog: ApiLog
    readonly page: Playwright.Page
    readonly hostile: Playwright.Frame
    readonly victim: Playwright.Frame | null
    readonly admin: ReturnType<typeof createDb>
  }
  readonly rec: Recorder
  /** Loads the dashboard with the hostile widget and its neighbour afresh. */
  boot(): Promise<void>
  /** Calls a function of the fixture in the hostile frame. */
  call<T = Json>(name: string, ...args: unknown[]): Promise<T>
  /** Registers a user on a server and returns the session. */
  register(base: string): Promise<{ email: string; refresh: string; access: string }>
}

interface Reply { readonly status: number; readonly text: string; readonly json: Json; readonly headers: Headers }

function csvRow(i: number): string {
  const day = String((i % 28) + 1).padStart(2, '0')
  return `03/${day}/2026,"CARD PURCHASE, STORE ${String(i % 997).padStart(3, '0')} CITY ${i % 331} REF POS",-${Math.floor(i / 100) + 1}.${String(i % 100).padStart(2, '0')},s-${i}`
}

async function startApi(): Promise<{ base: string; close: () => Promise<void> }> {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET, AUTH_ACCESS_TTL_SECONDS: '900',
    AUTH_RATE_LIMIT_MAX: '100000', AUTH_EMAIL_RATE_LIMIT_MAX: '100000', LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv)
  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT })
  const importCsv = BUNDLED_PLUGINS.find((m) => m.id === IMPORT_PLUGIN)
  if (importCsv === undefined) throw new Error('Import CSV is not a bundled plugin')
  const bundled = [importCsv, hostileManifest()]
  const app = buildApp({ db, config, pluginOptions: { bundled } })
  await app.ready()
  await new PluginService(new KyselyUnitOfWork(db), { bundled }).seedBundled()
  await app.listen({ port: 0, host: 'localhost' })
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://localhost:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

export async function runStaging(ctx: StagingContext): Promise<void> {
  const { rec } = ctx
  const first = { attacks: rec.results.length, checks: rec.checks.length }
  const add = (r: Omit<AttackResult, 'detail' | 'group'> & { detail?: unknown }): void => { rec.attack({ group: 'staging', ...r } as AttackResult) }

  // Import CSV is not necessarily mounted by `run.ts`'s own server, so the HTTP half has a server of its own. A registry row
  // that this adds, and `run.ts` did not, is removed again before the browser half.
  const importRow = async (): Promise<boolean> => (await ctx.world.admin.selectFrom('core.plugins').select('plugin_id').where('plugin_id', '=', IMPORT_PLUGIN).execute()).length > 0
  const hadRow = await importRow()
  const api = await startApi()
  try {
    await serverHalf(ctx, api.base, add)
  } finally {
    await api.close()
    if (!hadRow && (await importRow())) await ctx.world.admin.deleteFrom('core.plugins').where('plugin_id', '=', IMPORT_PLUGIN).execute()
  }
  await brokerHalf(ctx, add)
  console.log(`        staging: ${rec.results.length - first.attacks} attacks and ${rec.checks.length - first.checks} checks added to the suite totals`)
}

type Add = (r: Omit<AttackResult, 'detail' | 'group'> & { detail?: unknown }) => void

// ---------------------------------------------------------------------------
// The server, over HTTP
// ---------------------------------------------------------------------------

async function serverHalf(ctx: StagingContext, base: string, add: Add): Promise<void> {
  const { rec } = ctx
  const send = async (token: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-wickermoney-csrf': '1', 'content-type': 'application/json', ...extra },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    let json: Json = {}
    try { json = JSON.parse(text) as Json } catch { /* not JSON */ }
    return { status: res.status, text, json, headers: res.headers }
  }
  const mint = async (access: string, pluginId: string): Promise<string> => {
    const res = await send(access, 'POST', `/api/v1/plugins/${pluginId}/token`, {})
    const token = res.json['token']
    if (res.status !== 200 || typeof token !== 'string') throw new Error(`could not mint a ${pluginId} token: ${res.status} ${res.text.slice(0, 120)}`)
    return token
  }
  const kinds = async (): Promise<{ host: string; importCsv: string; hostile: string }> => {
    const user = await ctx.register(base)
    return { host: user.access, importCsv: await mint(user.access, IMPORT_PLUGIN), hostile: await mint(user.access, HOSTILE_PLUGIN_ID) }
  }
  const staging = (token: string) => ({
    begin: (chunks: number, bytes: number) => send(token, 'POST', `${UPLOAD}/upload/begin`, { chunks, bytes }),
    chunk: (uploadId: string, index: number, text: string) => send(token, 'POST', `${UPLOAD}/upload/chunk`, { uploadId, index, text }),
    finish: (uploadId: string) => send(token, 'POST', `${UPLOAD}/upload/finish`, { uploadId }),
    abort: (uploadId: string) => send(token, 'POST', `${UPLOAD}/upload/abort`, { uploadId }),
    analyze: (accountId: string, uploadId: string) => send(token, 'POST', `${UPLOAD}/analyze`, { accountId, uploadId, ...MAPPING }),
    commit: (accountId: string, uploadId: string) => send(token, 'POST', `${UPLOAD}/commit`, { accountId, uploadId, idempotencyKey: 'hostile-k', ...MAPPING }),
  })
  const account = async (host: string, name: string): Promise<string> => {
    const res = await send(host, 'POST', '/api/v1/accounts', { name, accountType: 'checking', openingBalance: '0.00' })
    if (res.status !== 201) throw new Error(`account failed: ${res.status} ${res.text.slice(0, 120)}`)
    return res.json['id'] as string
  }

  const victim = await kinds() // the user whose session a hostile frame lives in
  const owner = await kinds() // another user, who has a file staged
  const marker = 'SECRET-STAGED-MARKER-4c9e'
  const ownerCsv = `Date,Description,Amount,Id\n03/05/2026,"${marker}",-1.00,m-1\n03/06/2026,"second row",-2.00,m-2`
  const ownerFile = staging(owner.importCsv)
  const begun = await ownerFile.begin(1, Buffer.byteLength(ownerCsv))
  const ownerUpload = begun.json['uploadId'] as string
  const ownerChunk = await ownerFile.chunk(ownerUpload, 0, ownerCsv)
  const ownerFinish = await ownerFile.finish(ownerUpload)
  const ownerAccount = await account(owner.host, 'Owner')
  rec.check('control: the owner stages a file through a plugin token for Import CSV (begin, chunk, finish)', begun.status === 200 && ownerChunk.status === 200 && ownerFinish.status === 200, [begun.status, ownerChunk.status, ownerFinish.status])
  const ownerRead = await ownerFile.analyze(ownerAccount, ownerUpload)
  rec.check('control: the owner reads the staged file back by its id (analyze shows the text)', ownerRead.status === 200 && ownerRead.text.includes(marker), ownerRead.status)

  // 1. A token for another plugin, on every staging route. The route belongs to Import CSV; the token is the identity.
  const viaHostile = staging(victim.hostile)
  const wrongPlugin: Array<[string, () => Promise<Reply>]> = [
    ['begin', () => viaHostile.begin(1, 5)], ['chunk', () => viaHostile.chunk(ZERO_UUID, 0, 'abc')], ['finish', () => viaHostile.finish(ZERO_UUID)],
    ['abort', () => viaHostile.abort(ZERO_UUID)], ['analyze', () => viaHostile.analyze(ZERO_UUID, ownerUpload)], ['commit', () => viaHostile.commit(ZERO_UUID, ownerUpload)],
  ]
  for (const [route, run] of wrongPlugin) {
    const res = await send(victim.hostile, 'POST', `${UPLOAD}/${route === 'analyze' || route === 'commit' ? route : `upload/${route}`}`,
      route === 'begin' ? { chunks: 1, bytes: 5 } : { uploadId: ZERO_UUID }, { 'x-wickermoney-plugin': IMPORT_PLUGIN })
    const plain = await run()
    add({
      id: `st-wrong-plugin-${route}`, title: `a token for another plugin calls Import CSV's ${route} (plugin header forged to Import CSV)`, expected: 'server-refusal',
      reason: `${res.status} ${String(res.json['code'] ?? '')}; without the header ${plain.status} ${String(plain.json['code'] ?? '')}`,
      pass: res.status === 403 && res.json['code'] === 'plugin_route_denied' && plain.status === 403 && plain.json['code'] === 'plugin_route_denied' && !res.text.includes(marker),
      detail: { forged: res.text.slice(0, 160), plain: plain.text.slice(0, 160) },
    })
  }
  // Nothing was staged by them: the same user, through Import CSV's own token, still has both live slots.
  const mine = staging(victim.importCsv)
  const slot1 = await mine.begin(1, 10)
  const slot2 = await mine.begin(1, 10)
  const slot3 = await mine.begin(1, 10)
  rec.check('after the wrong-plugin calls the user still has both live upload slots (none was staged), and the third is refused', slot1.status === 200 && slot2.status === 200 && slot3.status === 409, [slot1.status, slot2.status, slot3.status])
  await mine.abort(slot1.json['uploadId'] as string)
  await mine.abort(slot2.json['uploadId'] as string)

  // 2. Another user's file, by every token the victim could hold, with every route that takes an id.
  const unknown = await staging(victim.host).chunk(ZERO_UUID, 0, 'x')
  const victimAccount = await account(victim.host, 'Victim')
  for (const [kind, token] of [['host', victim.host], ['importcsv', victim.importCsv], ['hostile', victim.hostile]] as const) {
    const s = staging(token)
    const replies: Array<[string, Reply]> = [
      ['chunk', await s.chunk(ownerUpload, 1, 'x')], ['finish', await s.finish(ownerUpload)],
      ['analyze', await s.analyze(victimAccount, ownerUpload)], ['commit', await s.commit(victimAccount, ownerUpload)],
    ]
    const abort = await s.abort(ownerUpload)
    const leaked = [...replies.map(([, r]) => r), abort].some((r) => r.text.includes(marker))
    const expected = kind === 'hostile'
      ? replies.every(([, r]) => r.status === 403 && r.json['code'] === 'plugin_route_denied') && abort.status === 403
      : replies.every(([, r]) => r.status === 404 && r.text === unknown.text) && abort.status === 200 && abort.text === '{}'
    add({
      id: `st-other-user-${kind}`, title: `read or change another user's staged file by id with the ${kind === 'host' ? "victim's own host token" : kind === 'importcsv' ? "victim's Import CSV token" : "victim's token for the hostile plugin"} (chunk, finish, analyze, commit, abort)`,
      expected: kind === 'hostile' ? 'server-refusal' : 'contained',
      reason: replies.map(([n, r]) => `${n} ${r.status}`).join(', ') + `, abort ${abort.status}; text leaked ${String(leaked)}`,
      pass: expected && !leaked, detail: { unknown: unknown.text, replies: replies.map(([n, r]) => [n, r.status, r.text.slice(0, 120)]) },
    })
  }
  const stillOwners = await ownerFile.analyze(ownerAccount, ownerUpload)
  rec.check("after those attempts the owner's staged file is untouched (analyze still shows its text)", stillOwners.status === 200 && stillOwners.text.includes(marker), stillOwners.status)

  // Guessing: 200 random ids answer the same body as the one unknown id, and none of them is a hit.
  const bodies = new Set<string>()
  let hits = 0
  const guesses = staging(victim.host)
  for (let i = 0; i < 200; i += 1) {
    const r = await guesses.chunk(crypto.randomUUID(), 0, 'x')
    bodies.add(`${r.status} ${r.text}`)
    if (r.status !== 404) hits += 1
  }
  add({ id: 'st-guess-ids', title: '200 random upload ids offered to /upload/chunk', expected: 'contained', reason: `${hits} answered other than 404; ${bodies.size} distinct answer(s)`, pass: hits === 0 && bodies.size === 1 })

  // 3. Chunks over the caps, through Import CSV's own token (as its frame would hold it).
  const open = await mine.begin(3, 600_000)
  const openId = open.json['uploadId'] as string
  const over = await mine.chunk(openId, 0, 'a'.repeat(BROKER_BODY_BYTES + 1))
  const huge = await mine.chunk(openId, 0, 'a'.repeat(1024 * 1024 + 1))
  const stored = await mine.chunk(openId, 1, 'b'.repeat(10))
  add({
    id: 'st-chunk-over-cap', title: 'a chunk of 256 KiB + 1 byte, and a request body over the route\'s 1 MiB limit', expected: 'server-refusal',
    reason: `256 KiB+1 -> ${over.status} ${String(over.json['code'] ?? '')}; over 1 MiB -> ${huge.status}; nothing stored: received ${String((stored.json as Json)['received'])}`,
    pass: over.status === 413 && over.json['code'] === 'chunk_too_large' && huge.status === 413 && stored.status === 200 && stored.json['received'] === 1,
  })
  await mine.abort(openId)

  // 4. A flood of begin (strict import bucket, 30 a minute) beside chunks (general bucket), as a user whose bucket nothing else has used.
  const flood = await kinds()
  const f = staging(flood.importCsv)
  const live = await f.begin(2, 6)
  const liveId = live.json['uploadId'] as string
  const codes: number[] = [live.status]
  let retryAfter = ''
  for (let i = 0; i < 44; i += 1) {
    const r = await f.begin(2, 6)
    codes.push(r.status)
    if (r.status === 429) retryAfter = r.headers.get('retry-after') ?? ''
  }
  const chunkCodes: number[] = []
  for (let i = 0; i < 40; i += 1) chunkCodes.push((await f.chunk(liveId, i % 2, i % 2 === 0 ? 'aaa' : 'bbb')).status)
  const fin = await f.finish(liveId)
  const counts = (xs: number[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})
  const begins = counts(codes)
  add({
    id: 'st-begin-flood', title: '45 begin calls in a row (import bucket 30 a minute), then 40 chunks and a finish on the upload that was opened', expected: 'server-refusal',
    reason: `begin ${JSON.stringify(begins)}, Retry-After ${retryAfter || 'none'}; chunks ${JSON.stringify(counts(chunkCodes))}, finish ${fin.status}`,
    pass: codes[0] === 200 && codes[1] === 200 && codes[2] === 409 && begins['429'] === 15 && Number(retryAfter) > 0 && chunkCodes.every((c) => c === 200) && fin.status === 200,
    detail: { codes, chunkCodes },
  })
}

// ---------------------------------------------------------------------------
// The broker, in the browser
// ---------------------------------------------------------------------------

/**
 * The planned uploader's traffic as plain source for the hostile frame: `begin`, then `chunks` chunk-shaped messages with `workers` in
 * flight, then `finish`, `analyze` and `commit`, each waiting for its answer. Plain JavaScript in a string, because the test runner's
 * transpiler adds helpers to named inner functions that the frame does not have.
 */
const UPLOADER_IN_FRAME = `async function (cfg) {
  var h = window.__hostile;
  var port = h.port;
  if (port === null) return { error: 'no port' };
  var waiting = new Map();
  var prior = port.onmessage;
  port.onmessage = function (e) {
    var d = e.data;
    if (d && typeof d.id === 'number' && waiting.has(d.id)) waiting.get(d.id)(d);
    if (prior) prior.call(port, e);
  };
  var text = '';
  for (var i = 0; text.length < cfg.chars; i += 1) text += '03/05/2026,"CARD PURCHASE, STORE ' + (i % 997) + ' CITY ' + (i % 331) + ' REF POS",-1.00,s-' + i + '\\n';
  text = text.slice(0, cfg.chars);
  var zero = '00000000-0000-4000-8000-000000000000';
  var nextId = 500000, inFlight = 0, peak = 0, tally = {};
  function send(path, body) {
    return new Promise(function (resolve) {
      var id = nextId++;
      function done(m) {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        inFlight -= 1;
        var e = m.error;
        var key = m.ok === true ? 'ok' : String(e && e.code) + ':' + String((e && e.status) || '') + (e && typeof e.message === 'string' && /too fast/.test(e.message) ? ':too-fast' : '');
        tally[key] = (tally[key] || 0) + 1;
        resolve();
      }
      waiting.set(id, done);
      inFlight += 1;
      if (inFlight > peak) peak = inFlight;
      setTimeout(function () { done({ timeout: true }); }, 8000);
      port.postMessage({ type: 'request', id: id, method: 'POST', path: path, body: body });
    });
  }
  var t0 = performance.now();
  await send(cfg.ns + '/upload/begin?hx=stup-begin', { chunks: cfg.chunks, bytes: 7000000 });
  var next = 0;
  async function worker() {
    for (;;) {
      var n = next++;
      if (n >= cfg.chunks) return;
      await send(cfg.ns + '/upload/chunk?hx=stup-chunk-' + n, { uploadId: zero, index: n, text: text });
    }
  }
  var pool = [];
  for (var k = 0; k < cfg.workers; k += 1) pool.push(worker());
  await Promise.all(pool);
  await send(cfg.ns + '/upload/finish?hx=stup-finish', { uploadId: zero });
  await send(cfg.ns + '/analyze?hx=stup-analyze', { uploadId: zero });
  await send(cfg.ns + '/commit?hx=stup-commit', { uploadId: zero });
  port.onmessage = prior;
  return { ms: Math.round(performance.now() - t0), peak: peak, tally: tally, messages: 1 + cfg.chunks + 3 };
}`

const codeOf = (reply: unknown): string => {
  const r = reply as Json | undefined
  if (r === undefined) return 'none'
  if (r['silence'] === true) return 'silence'
  if (r['ok'] === true) return 'ok'
  const e = r['error'] as Json | undefined
  return e !== undefined ? `${String(e['code'])}${e['status'] !== undefined ? `:${String(e['status'])}` : ''}` : String(r['type'] ?? 'other')
}

async function brokerHalf(ctx: StagingContext, add: Add): Promise<void> {
  const { rec } = ctx
  const w = ctx.world
  const { apiLog } = w
  const marked = (path: string, id: string): string => `${path}${path.includes('?') ? '&' : '?'}hx=${id}`
  const bodyOf = (text: string): Json => ({ uploadId: ZERO_UUID, index: 0, text })
  const base = Buffer.byteLength(JSON.stringify(bodyOf('')))

  // A. What a frame cannot send to Import CSV's routes: the broker refuses before anything leaves the page.
  await ctx.boot()
  const taken = await ctx.call('takePort')
  rec.check('control: the hostile frame holds a raw port to the broker (staging)', taken['port'] === true, taken)
  const routes: Array<[string, Json]> = [
    ['/p/wickermoney.import-csv/upload/begin', { chunks: 1, bytes: 5 }], ['/p/wickermoney.import-csv/upload/chunk', bodyOf('abc')],
    ['/p/wickermoney.import-csv/upload/finish', { uploadId: ZERO_UUID }], ['/p/wickermoney.import-csv/upload/abort', { uploadId: ZERO_UUID }],
    ['/p/wickermoney.import-csv/analyze', { uploadId: ZERO_UUID }], ['/p/wickermoney.import-csv/commit', { uploadId: ZERO_UUID }],
  ]
  const mark = apiLog.mark
  const refusals = await ctx.call<Array<{ reply: unknown }>>('raw', routes.map(([path, body], i) => ({ method: 'POST', path: marked(path, `st-b-route-${i}`), body })), 60)
  for (const [i, [path]] of routes.entries()) {
    const got = codeOf(refusals[i]?.reply)
    const reached = apiLog.withMarker(`st-b-route-${i}`, mark)
    add({ id: `st-broker-${path.split('/').slice(-1)[0] as string}`, title: `through the broker: POST ${path.replace('/p/wickermoney.import-csv', '')} of another plugin`, expected: 'broker-refusal', reason: `broker replied ${got}`, pass: got === 'grant_denied' && reached.length === 0, detail: { reply: refusals[i]?.reply, reached: reached.length } })
  }

  // B. The body cap, on a message shaped like a chunk. The plugin's own namespace stands in for the route: the broker's decision is the same.
  const cap = BROKER_BODY_BYTES
  const csvText = (chars: number): string => { let s = ''; for (let i = 0; s.length < chars; i += 1) s += `${csvRow(i)}\n`; return s.slice(0, chars) }
  const sized: Array<{ id: string; path: string; body: Json; allowed: boolean; title: string }> = [
    { id: 'st-cap-at', allowed: true, title: 'a chunk whose serialised body is exactly 256 KiB', body: bodyOf('a'.repeat(cap - base)), path: `/p/${HOSTILE_PLUGIN_ID}/upload/chunk` },
    { id: 'st-cap-csv-200k', allowed: true, title: 'a chunk of 200,000 characters of ordinary CSV (the planned size)', body: bodyOf(csvText(200_000)), path: `/p/${HOSTILE_PLUGIN_ID}/upload/chunk` },
    { id: 'st-cap-over', allowed: false, title: 'a chunk whose serialised body is 256 KiB + 1 byte', body: bodyOf('a'.repeat(cap - base + 1)), path: `/p/${HOSTILE_PLUGIN_ID}/upload/chunk` },
    { id: 'st-cap-quotes-200k', allowed: false, title: 'a chunk of 200,000 quote characters (JSON writes each as two bytes)', body: bodyOf('"'.repeat(200_000)), path: `/p/${HOSTILE_PLUGIN_ID}/upload/chunk` },
    { id: 'st-cap-accents-200k', allowed: false, title: 'a chunk of 200,000 two-byte characters (400,000 bytes)', body: bodyOf('é'.repeat(200_000)), path: `/p/${HOSTILE_PLUGIN_ID}/upload/chunk` },
    { id: 'st-cap-1m', allowed: false, title: 'a chunk of 1 MiB + 1 byte (the route\'s own body limit)', body: bodyOf('a'.repeat(1024 * 1024 + 1)), path: `/p/${HOSTILE_PLUGIN_ID}/upload/chunk` },
    { id: 'st-cap-8m', allowed: false, title: 'a whole 8 MB file as one chunk', body: bodyOf('a'.repeat(8_000_000)), path: `/p/${HOSTILE_PLUGIN_ID}/upload/chunk` },
  ]
  const capMark = apiLog.mark
  const capReplies = await ctx.call<Array<{ reply: unknown }>>('raw', sized.map((s) => ({ method: 'POST', path: marked(s.path, s.id), body: s.body })), 100)
  for (const [i, s] of sized.entries()) {
    const got = codeOf(capReplies[i]?.reply)
    const reached = apiLog.withMarker(s.id, capMark)
    if (s.allowed) {
      rec.check(`control: ${s.title} passes the broker (it reaches the API)`, reached.length === 1 && got !== 'invalid_request', { got, reached: reached.length })
    } else {
      add({ id: s.id, title: s.title, expected: 'broker-refusal', reason: got === 'silence' ? 'dropped, no reply' : `broker replied ${got}`, pass: got === 'invalid_request' && reached.length === 0, detail: capReplies[i]?.reply })
    }
  }

  // C. A flood of begin- and chunk-shaped messages, as fast as the frame can post them. The page and the neighbour must go on answering.
  await ctx.boot()
  await ctx.call('takePort')
  const floodMark = apiLog.mark
  const t0 = Date.now()
  const responsive = (async (): Promise<number> => { await sleep(400); const s = Date.now(); await w.page.evaluate(() => 1); return Date.now() - s })()
  const flooded = await w.hostile.evaluate(async ({ count, chars, ns }) => {
    const h = (window as unknown as { __hostile: { port: MessagePort | null } }).__hostile
    const port = h.port
    if (port === null) return { error: 'no port' } as Record<string, unknown>
    const replies: Array<Record<string, unknown>> = []
    const prior = port.onmessage
    port.onmessage = (e: MessageEvent) => { replies.push(e.data as Record<string, unknown>); prior?.call(port, e) }
    let text = ''
    for (let i = 0; text.length < chars; i += 1) text += `03/05/2026,"CARD PURCHASE, STORE ${i % 997} CITY ${i % 331} REF POS",-1.00,s-${i}\n`
    text = text.slice(0, chars)
    for (let i = 0; i < count; i += 1) {
      const begin = i % 2 === 0
      try {
        port.postMessage({
          type: 'request', id: 400_000 + i, method: 'POST', path: `${ns}/upload/${begin ? 'begin' : 'chunk'}?hx=stflood-${i}`,
          body: begin ? { chunks: 36, bytes: 7_000_000 } : { uploadId: '00000000-0000-4000-8000-000000000000', index: i % 36, text },
        })
      } catch { break }
    }
    await new Promise((r) => setTimeout(r, 2500))
    port.onmessage = prior
    const codes: Record<string, number> = {}
    for (const r of replies) {
      const e = r['error'] as Record<string, unknown> | undefined
      const key = r['ok'] === true ? 'ok' : `${String(e?.['code'])}:${String(e?.['status'] ?? '')}`
      codes[key] = (codes[key] ?? 0) + 1
    }
    return { sent: count, replies: replies.length, codes }
  }, { count: 160, chars: 200_000, ns: `/p/${HOSTILE_PLUGIN_ID}` })
  const responsiveMs = await responsive
  const reachedFlood = apiLog.since(floodMark).filter((e) => e.url.includes('hx=stflood-'))
  const seconds = (Date.now() - t0) / 1000
  const victim = w.victim === null ? null : await w.victim.evaluate(() => (window as unknown as { __victim: { info(): Promise<Json> } }).__victim.info())
  const allowance = Math.ceil(40 + 20 * seconds + 12)
  const ended = !(await ctx.call<boolean>('portAlive'))
  add({
    id: 'st-broker-flood', title: '160 begin- and chunk-shaped messages (80 of them about 200 KB) posted in one burst', expected: 'broker-refusal',
    reason: `${reachedFlood.length} reached the API (allowance ${allowance}); replies ${JSON.stringify(flooded['codes'])}; ${ended ? 'the broker ended the connection' : 'the port still answers'}; the page answered in ${responsiveMs} ms`,
    pass: reachedFlood.length <= allowance && reachedFlood.length < 160 && responsiveMs < 1500 && victim?.['read'] === 'ok',
    detail: { flooded, reached: reachedFlood.length, allowance, responsiveMs, ended, victim },
  })

  // D. The planned uploader's own traffic through the real broker: 6 in flight, 36 chunks of about 200,000 characters, begin and finish,
  // then analyze and commit. A quiet page, so it must pass without a refusal; the broker's limiter, not the API's, is what is measured.
  await ctx.boot()
  await ctx.call('takePort')
  const upMark = apiLog.mark
  const shaped = await w.hostile.evaluate(`(${UPLOADER_IN_FRAME})(${JSON.stringify({ chunks: 36, chars: 200_000, workers: 6, ns: `/p/${HOSTILE_PLUGIN_ID}` })})`) as Json
  const upReached = apiLog.since(upMark).filter((e) => e.url.includes('hx=stup-'))
  const tooFast = Object.entries((shaped['tally'] as Record<string, number> | undefined) ?? {}).filter(([k]) => k.endsWith(':too-fast')).reduce((n, [, v]) => n + v, 0)
  rec.check(
    `the planned uploader's traffic (begin, 36 chunks of 200,000 characters at 6 in flight, finish, analyze, commit = ${String(shaped['messages'])} messages) passes the broker with no refusal: ${upReached.length} reached the API, ${tooFast} refused as too fast, peak ${String(shaped['peak'])} in flight, ${String(shaped['ms'])} ms`,
    upReached.length === 40 && tooFast === 0 && Number(shaped['peak']) <= 6, shaped,
  )
  const alive = await ctx.call<boolean>('portAlive')
  rec.check('after the staging traffic the broker still serves a valid request on the same port', alive)
}
