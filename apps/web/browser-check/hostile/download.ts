/**
 * A frame asks the host to save a file (the `download` message), and the two other protocol additions of release 0.9.0:
 * `notify` and `closing`. `run.ts` calls `runDownload` as one phase (`ONLY=download`).
 *
 * The hostile plugin is bundled, so the bundled check passes and everything else is the checks under test: the sandbox
 * (a frame cannot download by itself), the gesture, the type, the size, the bytes, the name and the rate. Each attack
 * is judged by what the browser saved (Playwright's `download` event: name, size, first bytes) and by what the broker
 * answered. The fixture makes the request from a timer or from the handler of a real click inside the frame, and the
 * runner makes no `evaluate` in the 5 seconds before a request that must be refused for lack of a gesture: Playwright
 * runs `evaluate` with CDP `userGesture: true`, which gives the evaluating frame and its ancestors transient activation.
 *
 * The residual is pinned, not hidden: a frame that is loaded within the activation window of a click on the host (not in
 * the frame) can take focus and satisfy the default gate. The strict gate that closes it is implemented and unit tested
 * but not wired, so it has no browser run here; see `downloadGate.ts`.
 *
 * The phase has its own time budget ({@link DOWNLOAD_BUDGET_MS}): most of its time is waiting for the 5 second
 * activation window to end, so a slower phase means a wait was added.
 */
import { readFileSync } from 'node:fs'
import type * as Playwright from 'playwright-core'
import type { BrowserLog, Recorder } from './lib.js'
import { sleep } from './lib.js'

type Json = Record<string, unknown>
interface DlSpec { filename: string; mime: string; bytes: number[] | { len: number; head: number[] } }

/** What the phase may take, in milliseconds. About 70 seconds of it are the waits the gesture rules need. */
export const DOWNLOAD_BUDGET_MS = 150_000

export interface DownloadContext {
  readonly world: {
    readonly page: Playwright.Page
    readonly log: BrowserLog
  }
  readonly rec: Recorder
  /** Loads the hostile widget and its neighbour (`dashboard`) or the hostile page afresh. */
  boot(where?: 'dashboard' | 'page'): Promise<void>
  call<T = Json>(name: string, ...args: unknown[]): Promise<T>
  /** The compact answer code of a raw reply, as `run.ts` reads it. */
  code(reply: unknown): string
}

const PNG_1X1 = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')]
const PNG_HEAD = PNG_1X1.slice(0, 8)
const RLO = String.fromCharCode(0x202e)

export async function runDownload(c: DownloadContext): Promise<void> {
  const { world: w, rec } = c
  const started = Date.now()
  const files: Array<{ name: string; size: number; head: string }> = []
  const watch = (): void => {
    files.length = 0
    w.page.on('download', (d) => {
      void d.path().then((p) => {
        const b = readFileSync(p)
        files.push({ name: d.suggestedFilename(), size: b.length, head: b.subarray(0, 4).toString('hex') })
      })
    })
  }
  const click = async (): Promise<void> => {
    const box = (await w.page.locator('iframe[title^="Hostile"]').boundingBox())!
    await w.page.mouse.click(box.x + 40, box.y + 40)
  }
  const rcode = (r: unknown): string => {
    const x = (r as { reply?: Json } | undefined)?.reply
    return x === undefined ? c.code(r) : c.code(x)
  }
  const spec = (filename: string, mime = 'image/png', bytes: DlSpec['bytes'] = PNG_1X1): DlSpec => ({ filename, mime, bytes })
  const replies = (): Promise<Array<{ reply: unknown; ms: number }>> => c.call('getDownloadReplies')
  const fresh = async (): Promise<void> => { await c.boot('page'); await c.call('takePort'); watch() }

  const piggyOnly = process.env['DOWNLOAD_ONLY'] === 'piggyback'
  if (!piggyOnly) {
  // ---- notify and closing: the hostile manifest declares no permissions ----
  await c.boot()
  await c.call('takePort')
  const hostText = (): Promise<string> => w.page.evaluate(() => document.body.innerText)
  const marker = 'hxnotify-marker'
  const once = await c.call<Json>('notifyBurst', 1, marker)
  const onceCodes = JSON.stringify((once['codes'] as Json | undefined) ?? {})
  rec.attack({
    id: 'notify-no-permission', group: 'download', title: 'a valid notify message from a plugin whose manifest declares no notify permission',
    expected: 'broker-refusal', reason: `answered ${onceCodes}; the host page ${(await hostText()).includes(marker) ? 'SHOWS' : 'does not show'} the text`,
    pass: onceCodes === '{"grant_denied:":1}' && !(await hostText()).includes(marker),
  })
  const burst = await c.call<Json>('notifyBurst', 40, marker)
  const alive = await c.call<boolean>('portAlive')
  const responsive = await Promise.race([w.page.evaluate(() => 1), sleep(3000).then(() => 0)])
  rec.attack({
    id: 'notify-flood', group: 'download', title: '40 notify messages in one burst, to put toasts on the person\'s screen',
    expected: 'broker-refusal', reason: `answered ${JSON.stringify(burst['codes'])}; ${alive ? 'the port still answers' : 'the broker ended the connection'}; the host answered in time ${String(responsive === 1)}`,
    pass: !(await hostText()).includes(marker) && responsive === 1 && Object.keys((burst['codes'] ?? {}) as Json).every((k) => k !== 'ok'),
  })
  await c.boot()
  await c.call('takePort')
  const closingReply = await c.call<unknown>('sendClosingToHost')
  rec.attack({
    id: 'closing-from-frame', group: 'download', title: 'the frame sends `closing`, a message only the host sends',
    expected: 'broker-refusal', reason: `${c.code(closingReply)}; the port ${(await c.call<boolean>('portAlive')) ? 'still answers' : 'was ended'}`,
    pass: c.code(closingReply) === 'silence' && (await c.call<boolean>('portAlive')),
  })

  // ---- download ----
  await fresh()
  // NOTE: no `evaluate` in the 5 s before a request that must be refused for lack of a gesture.

  // 0. The sandbox is unchanged, so the frame cannot download by itself.
  const mark0 = w.log.mark
  await click()
  await c.call('directAnchorDownload')
  await sleep(800)
  const direct = w.log.consoleSince(mark0).map((x) => x.text).find((t) => /Download is disallowed/.test(t)) ?? ''
  rec.attack({ id: 'dl-direct-anchor', group: 'download', title: 'the frame clicks <a download href=blob:> itself, right after a real click', expected: 'browser-block', reason: direct.slice(0, 130), pass: direct !== '' && files.length === 0 })

  // 1. The honest path: a real click in the frame, the frame sends the file from its handler.
  await sleep(5500)
  files.length = 0
  await c.call('armDownload', [spec('Share card.png')])
  await click()
  await sleep(1200)
  const honest = await replies()
  rec.check('honest: click in the frame, then download (PNG, 70 bytes): the host replies ok with the final name and the browser saves exactly those bytes',
    rcode(honest[0]) === 'ok' && files.length === 1 && files[0]!.name === 'Share card.png' && files[0]!.size === PNG_1X1.length && files[0]!.head === '89504e47', { honest, files })

  // 1b. A second file inside the same activation window.
  await c.call('armDownload', [spec('second.png')])
  await click()
  await sleep(800)
  const within = await replies()
  rec.attack({ id: 'dl-second-in-same-activation', group: 'download', title: 'a second click and a second valid file 2 s after the first (same 5 s window)', expected: 'broker-refusal', reason: `reply ${rcode(within[0])}`, pass: rcode(within[0]) === 'rate_limited' && files.length === 1 })

  // 2. No gesture at all: the frame's timer fires 5.8 s after the last evaluate (activation lasts 5 s).
  await c.call('scheduleDownloads', [spec('quiet.png')], 5800)
  await sleep(6800)
  const bare = await replies()
  rec.attack({ id: 'dl-no-gesture', group: 'download', title: 'download with no click or key press in the page (timer in the frame, 5.8 s after the last input)', expected: 'broker-refusal', reason: `reply ${rcode(bare[0])}`, pass: rcode(bare[0]) === 'gesture_required' && files.length === 1 })

  // 3. Expired gesture: a real click, the frame waits 6.2 s, then asks.
  await c.call('armDownload', [spec('late.png')], { delayMs: 6200 })
  await click()
  await sleep(7500)
  const stale = await replies()
  rec.attack({ id: 'dl-stale-gesture', group: 'download', title: 'download 6.2 s after a real click (transient activation has expired)', expected: 'broker-refusal', reason: `reply ${rcode(stale[0])}`, pass: rcode(stale[0]) === 'gesture_required' && files.length === 1 })

  // 4. Type, size and content checks, each after a fresh real click so only the check can refuse.
  const refusals: Array<[string, DlSpec, string, boolean?]> = [
    ['mime text/html', spec('x.html', 'text/html', [...Buffer.from('<script>alert(1)</script>')]), 'file_type_not_allowed'],
    ['mime image/svg+xml', spec('x.svg', 'image/svg+xml', [...Buffer.from('<svg onload=alert(1)/>')]), 'file_type_not_allowed'],
    ['mime application/x-msdownload', spec('x.exe', 'application/x-msdownload', [0x4d, 0x5a, 0x90]), 'file_type_not_allowed'],
    ['mime IMAGE/PNG (case)', spec('x.png', 'IMAGE/PNG'), 'file_type_not_allowed'],
    ['mime image/png;charset=x', spec('x.png', 'image/png;charset=x'), 'file_type_not_allowed'],
    ['mime toString', spec('x.png', 'toString'), 'file_type_not_allowed'],
    ['png type, HTML bytes', spec('x.png', 'image/png', [...Buffer.from('<html><script>1</script>')]), 'file_invalid'],
    ['pdf type, PNG bytes', spec('x.pdf', 'application/pdf'), 'file_invalid'],
    ['text type, binary bytes', spec('x.txt', 'text/plain', [0x41, 0x00, 0x42]), 'file_invalid'],
    ['text type, an HTML page', spec('x.txt', 'text/plain', [...Buffer.from('<!DOCTYPE html><script>alert(1)</script>')]), 'file_invalid'],
    ['empty file', spec('x.png', 'image/png', []), 'file_invalid'],
    ['5 MiB + 1 byte, transferred', spec('big.png', 'image/png', { len: 5 * 1024 * 1024 + 1, head: PNG_HEAD }), 'file_too_large'],
    ['200 MB, transferred', spec('huge.png', 'image/png', { len: 200_000_000, head: PNG_HEAD }), 'file_too_large'],
    ['32 MB, sent by copy and not transferred (the host must receive it before it can look)', spec('clone.png', 'image/png', { len: 32_000_000, head: PNG_HEAD }), 'file_too_large', false],
  ]
  await w.page.evaluate(() => {
    const g = window as unknown as { __lt: number[] }
    g.__lt = []
    new PerformanceObserver((l) => { for (const e of l.getEntries()) g.__lt.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] })
  })
  for (const [label, s, want, transfer] of refusals) {
    await c.call('armDownload', [s], { transfer: transfer ?? true })
    await click()
    await sleep(label.startsWith('32 MB') ? 3000 : 900)
    const out = (await replies())[0]!
    const probe = await w.page.evaluate(() => new Promise<number>((r) => { const t = performance.now(); setTimeout(() => { r(Math.round(performance.now() - t)) }, 0) }))
    const longest = await w.page.evaluate(() => Math.max(0, ...(window as unknown as { __lt: number[] }).__lt.splice(0)))
    rec.attack({
      id: `dl-refuse-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}`, group: 'download', title: `with a fresh click: ${label}`,
      expected: 'broker-refusal',
      reason: `${rcode(out)} in ${String(out.ms)} ms (as measured in the frame); the host's longest main-thread task meanwhile ${longest} ms (next timer ${probe} ms)`,
      pass: rcode(out) === want && files.length === 1,
    })
  }

  // 5. Spam inside one click: 20 valid files in a row.
  await sleep(5200)
  files.length = 0
  await c.call('armDownload', Array.from({ length: 20 }, (_, i) => spec(`spam ${i}.png`)))
  await click()
  await sleep(2500)
  const codes = (await replies()).map(rcode)
  rec.attack({
    id: 'dl-spam-one-click', group: 'download', title: 'one click, then 20 valid download messages in a row', expected: 'broker-refusal',
    reason: `replies ${codes.filter((x) => x === 'ok').length} ok, ${codes.filter((x) => x === 'rate_limited').length} rate_limited; ${files.length} file(s) saved`,
    pass: codes[0] === 'ok' && codes.slice(1).every((x) => x === 'rate_limited') && files.length === 1,
  })

  // 6. Hostile name, real click: what the browser saved.
  await sleep(5200)
  files.length = 0
  await c.call('armDownload', [spec(`../../Windows/System32/evil${RLO}gpj.exe.png`)])
  await click()
  await sleep(1200)
  const traversal = await replies()
  const saved = files[0]?.name ?? ''
  rec.attack({
    id: 'dl-hostile-filename', group: 'download', title: 'name "../../Windows/System32/evil<RLO>gpj.exe.png" with a real click', expected: 'contained', reason: `saved as ${JSON.stringify(saved)}`,
    pass: rcode(traversal[0]) === 'ok' && /^[\p{L}\p{N} _()-]+\.png$/u.test(saved), detail: { traversal, files },
  })

  // 7. A frame that sends gesture-less requests is struck, and an honest click afterwards still works.
  await sleep(5200)
  await c.call('scheduleDownloads', Array.from({ length: 30 }, () => spec('quiet.png')), 5800, { gapMs: 20 })
  await sleep(7500)
  const quiet = (await replies()).map(rcode)
  files.length = 0
  await c.call('armDownload', [spec('after spam.png')])
  await click()
  await sleep(1200)
  const after = await replies()
  rec.check('30 gesture-less requests (30 strikes of 100): all refused; then a real click and a valid file is still saved',
    quiet.every((x) => x === 'gesture_required') && rcode(after[0]) === 'ok' && files.length === 1, { quiet: [...new Set(quiet)], after, files })

  }
  // 8. The residual: a frame that asks right after the person clicked something on the host (not in the frame).
  //    The default gate cannot tell; the strict gate that could is not wired. Pinned: the answer is `ok` and one file.
  for (const n of [1, 2]) {
    await sleep(5200)
    await fresh()
    // A point on the host that is not a link, a button or the frame: the navigation column's own background.
    const blank = await w.page.evaluate(() => {
      const nav = document.querySelector('.shell__nav')!.getBoundingClientRect()
      for (let y = Math.min(innerHeight - 4, nav.bottom - 4); y > nav.top; y -= 6) {
        const el = document.elementFromPoint(nav.left + 4, y)
        if (el !== null && el.closest('a, button, iframe, input, select') === null && el.closest('.shell__nav') !== null) return { x: nav.left + 4, y }
      }
      return null
    })
    rec.check(`a blank point on the host's navigation exists for the host click (run ${n})`, blank !== null, blank)
    await sleep(5200) // the evaluates above gave 5 s of activation: let it end
    // The frame takes focus and waits for the click itself: it asks 3.4 s after it loses focus, so the gap between the person's
    // click and the request is fixed by the frame, not by how long the runner took to click.
    await c.call('armPiggyback', [spec('piggyback.png')], 3400)
    await sleep(5200) // the arm's own evaluate gave the page 5 s of activation: let it end before the click
    await w.page.mouse.click(blank?.x ?? 100, blank?.y ?? 880) // a real host click, no navigation
    await sleep(3600) // the frame's 3.4 s timer
    // Then the answer, however long the frame needs: where the browser never gives the frame the focus (a headless CI display) it
    // waits out its 1.5 s focus timeout and then asks 20 times, about 4 s in all, so a fixed wait would read "no reply" for a frame
    // that is still asking. Poll up to 10 s; a reply that never comes still fails.
    let piggy = await replies()
    for (const deadline = Date.now() + 10_000; piggy.length === 0 && Date.now() < deadline;) { await sleep(250); piggy = await replies() }
    await sleep(500) // let a saved file reach the disk before it is counted
    const focus = await c.call<Json>('getFocusState')
    const blurAt = await c.call<number | null>('getBlurAt')
    // Two outcomes are acceptable and the second is a stronger gate than the one pinned: the file is saved (the residual, as
    // pinned), or it is refused with `gesture_required` and nothing is saved (the activation had gone, or the browser did not give
    // the iframe the focus). Anything else fails: a file saved for any other reply, or a reply that is not one of these, or a click
    // the frame never saw.
    const saved = rcode(piggy[0]) === 'ok' && files.length === 1
    const refused = rcode(piggy[0]) === 'gesture_required' && files.length === 0
    rec.attack({
      id: `dl-piggyback-${n}`, group: 'residual',
      title: 'the person clicks the host (not the frame); 3.4 s later the frame takes focus and asks for a file, again every 100 ms while it is refused for want of focus (default gate: activation + the iframe is the active element)',
      expected: 'residual',
      reason: `reply ${rcode(piggy[0])}; the frame saw the click ${blurAt !== null ? 'yes' : 'NO'}; frame focus ${JSON.stringify(focus)}; ${files.length} file(s) saved; ${saved ? 'observed: the residual, as pinned' : refused ? 'observed: refused, a safe outcome (stronger than pinned)' : 'NOT AS PINNED'}`,
      pass: blurAt !== null && (saved || refused),
    })
  }

  const took = Date.now() - started
  rec.check(`the download phase finished inside its own budget of ${DOWNLOAD_BUDGET_MS / 1000} s (took ${(took / 1000).toFixed(1)} s)`, took <= DOWNLOAD_BUDGET_MS, { took })
}
