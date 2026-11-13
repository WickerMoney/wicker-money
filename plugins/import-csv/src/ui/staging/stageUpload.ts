import type { PluginApi } from '@wickermoney/plugin-sdk'
import { IMPORT_API_BASE } from '../../server/constants.js'
import type { UploadPlan } from './planUpload.js'
import { RequestPacer } from './RequestPacer.js'
import { StagingFailure } from './StagingFailure.js'
import { CHUNKS_IN_FLIGHT, RETRY_WAITS_MS } from './stagingLimits.js'

/** What staging asks of the plugin's API client: only `post`. */
export type StagingApi = Pick<PluginApi, 'post'>

/** Options for {@link stageUpload}. */
export interface StagingOptions {
  /** Called as chunks are accepted: how many of the total. */
  readonly onProgress?: (sent: number, total: number) => void
  /** Shared by every upload of one page, so two uploads together still keep to the frame's limit. */
  readonly pacer?: RequestPacer
  /** Waiting between retries; the real timer by default. */
  readonly sleep?: (ms: number) => Promise<void>
}

/** One upload in progress, or finished. */
export interface StagingHandle {
  /** Resolves with the upload id once the server has every chunk and has accepted `finish`. Rejects with a {@link StagingFailure}. */
  readonly ready: Promise<string>
  readonly state: () => 'pending' | 'ready' | 'failed'
  /** Stops sending and tells the server to discard what it holds, so the person is not kept at the 2-upload limit. Safe to call at any time, more than once. */
  readonly abort: () => void
}

type Failure = { status?: unknown; code?: unknown; message?: unknown }

const statusOf = (e: unknown): number => (typeof (e as Failure)?.status === 'number' ? ((e as Failure).status as number) : 0)
const codeOf = (e: unknown): string | undefined => (typeof (e as Failure)?.code === 'string' ? ((e as Failure).code as string) : undefined)
const messageOf = (e: unknown): string => (e instanceof Error && e.message !== '' ? e.message : '')

/** A request worth sending again: the connection, a busy server, a server error. Not a refusal of what was sent. */
function isTransient(e: unknown): boolean {
  const status = statusOf(e)
  if (status > 0) return status === 429 || (status >= 500 && codeOf(e) !== 'staging_full')
  const code = codeOf(e)
  return code === undefined || code === 'network_error' || code === 'disconnected'
}

/** Refusals after which the server has already thrown the upload away. */
const DISCARDED = new Set(['upload_size_mismatch', 'upload_not_text', 'upload_too_large'])

const isGone = (e: unknown): boolean => statusOf(e) === 404 && codeOf(e) === 'upload_not_found'

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Uploads a planned file to the server's staging area: `begin`, every chunk
 * (several at a time, paced), then `finish`.
 *
 * Starts at once and runs on its own, so a person can map columns while it
 * works. What it does when something goes wrong:
 *
 * - a request that fails on the connection, or with a server error or `429`, is
 *   sent again twice (a chunk sent twice is harmless to the server);
 * - `503 staging_full` and `409 too_many_uploads` on `begin` end it with the
 *   server's own words (the first says how long to wait);
 * - `404 upload_not_found` while sending (the upload expired, or the server
 *   restarted) starts over once with a new upload, then ends it;
 * - `409 upload_incomplete` on `finish` sends the chunks again, once or twice,
 *   then `finish` again;
 * - `400` on `finish` (the server discarded the upload) ends it with a message
 *   to choose the file again;
 * - any other failure discards what the server holds (so the 2-upload limit is
 *   not used up) and ends it.
 *
 * @param api - The plugin's API client.
 * @param plan - The file's pieces and size, from {@link planUpload}.
 * @param options - Progress, pacing, waiting.
 * @returns A handle with the result and a way to stop.
 */
export function stageUpload(api: StagingApi, plan: UploadPlan, options: StagingOptions = {}): StagingHandle {
  const pacer = options.pacer ?? new RequestPacer()
  const wait = options.sleep ?? realSleep
  const total = plan.chunks.length
  const controller = new AbortController()
  let cancelled = false
  let state: 'pending' | 'ready' | 'failed' = 'pending'
  /** The id the server holds now, if any. */
  let held: string | undefined
  let acked = new Set<number>()

  const cancelledFailure = (): StagingFailure => new StagingFailure('cancelled', 'The upload was cancelled.')

  /** One paced request, sent again when it fails in a way that may pass. `begin` is not cancelled mid-flight, so its id is never lost. */
  async function send<T>(path: string, body: unknown, cancellable: boolean): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await pacer.take(() => cancelled)
      } catch {
        throw cancelledFailure()
      }
      try {
        return await api.post<T>(`${IMPORT_API_BASE}${path}`, body, cancellable ? { signal: controller.signal } : undefined)
      } catch (e) {
        if (cancelled) throw cancelledFailure()
        const waitMs = RETRY_WAITS_MS[attempt]
        if (waitMs === undefined || !isTransient(e)) throw e
        await wait(waitMs)
      }
    }
  }

  const tell = (id: string): void => {
    // Not paced and not cancellable: one small request that must go even as the page is going.
    api.post(`${IMPORT_API_BASE}/upload/abort`, { uploadId: id }).catch(() => undefined)
  }

  async function sendChunks(id: string, indexes: readonly number[]): Promise<void> {
    let next = 0
    let failure: unknown
    const worker = async (): Promise<void> => {
      while (failure === undefined && !cancelled) {
        const at = next
        next += 1
        const index = indexes[at]
        if (index === undefined) return
        try {
          await send('/upload/chunk', { uploadId: id, index, text: plan.chunks[index] }, true)
          acked.add(index)
          options.onProgress?.(acked.size, total)
        } catch (e) {
          failure ??= e
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CHUNKS_IN_FLIGHT, indexes.length) }, worker))
    if (cancelled) throw cancelledFailure()
    if (failure !== undefined) throw failure
  }

  async function attempt(restartsLeft: number): Promise<string> {
    acked = new Set()
    options.onProgress?.(0, total)
    let begun: { uploadId: string }
    try {
      begun = await send<{ uploadId: string }>('/upload/begin', { chunks: total, bytes: plan.bytes }, false)
    } catch (e) {
      if (e instanceof StagingFailure) throw e
      if (statusOf(e) === 503 && codeOf(e) === 'staging_full') throw new StagingFailure('busy', messageOf(e))
      if (statusOf(e) === 409 && codeOf(e) === 'too_many_uploads') throw new StagingFailure('too_many', messageOf(e))
      if (statusOf(e) === 400) throw new StagingFailure('too_big', messageOf(e) || 'The server did not accept that file.')
      throw e
    }
    held = begun.uploadId
    if (cancelled) throw cancelledFailure()

    try {
      await sendChunks(held, plan.chunks.map((_, i) => i))
      for (let tries = 0; ; tries += 1) {
        try {
          await send('/upload/finish', { uploadId: held }, true)
          return held
        } catch (e) {
          if (statusOf(e) !== 409 || codeOf(e) !== 'upload_incomplete' || tries >= 2) throw e
          // A chunk is missing on the server: send the ones not acknowledged, or all of them if every one was.
          const missing = plan.chunks.map((_, i) => i).filter((i) => !acked.has(i))
          await sendChunks(held, missing.length > 0 ? missing : plan.chunks.map((_, i) => i))
        }
      }
    } catch (e) {
      if (isGone(e)) {
        held = undefined
        if (restartsLeft > 0 && !cancelled) return attempt(restartsLeft - 1)
        throw new StagingFailure('gone', 'The server lost your file while it was being sent, twice. Choose the file again.')
      }
      throw e
    }
  }

  /** What to tell a person, and whether the server still holds the upload. */
  function failureFor(e: unknown): StagingFailure {
    if (e instanceof StagingFailure) return e
    const status = statusOf(e)
    if (status === 400 || status === 413) {
      if (DISCARDED.has(codeOf(e) ?? '')) held = undefined
      return new StagingFailure('restart', `${messageOf(e) || 'The server could not use the file as it was sent.'} Choose the file again.`)
    }
    const why = messageOf(e)
    return new StagingFailure('interrupted', `Your file could not be sent to the server${why === '' ? '' : `: ${why}`} Try again, or choose the file again.`)
  }

  const ready = attempt(1).then(
    (id) => {
      if (cancelled) {
        state = 'failed'
        throw cancelledFailure()
      }
      state = 'ready'
      return id
    },
    (e: unknown) => {
      state = 'failed'
      const failure = failureFor(e)
      // Whatever the server still holds for this upload is of no use now, and counts against the person's two.
      if (held !== undefined && failure.kind !== 'gone') tell(held)
      held = undefined
      throw failure
    },
  )
  // The caller may never await it (another file was chosen first); that is not an unhandled rejection.
  ready.catch(() => undefined)

  return {
    ready,
    state: () => state,
    abort() {
      if (cancelled) return
      cancelled = true
      controller.abort()
      // Before `begin` answers there is no id to give back; `attempt` gives it back when it does.
      if (held !== undefined) {
        tell(held)
        held = undefined
      }
    },
  }
}
