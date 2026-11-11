import { randomUUID } from 'node:crypto'
import { ImportError } from '../service/ImportError.js'
import {
  MAX_CHUNK_BYTES, MAX_LIVE_UPLOADS_PER_USER, MAX_RECEIPTS_PER_USER, MAX_STAGED_BYTES_TOTAL,
  MAX_UPLOAD_BYTES, MAX_UPLOAD_CHUNKS, SWEEP_INTERVAL_MS, UPLOAD_TTL_MS,
} from './limits.js'
import type { StagedUpload } from './StagedUpload.js'
import type { UploadReceipt } from './UploadReceipt.js'
import type { UploadStoreOptions } from './UploadStoreOptions.js'
import { stagingFull, tooManyUploads, uploadNotFound } from './uploadErrors.js'
import { utf8Length } from './utf8Length.js'

/** Seconds a refused `begin` is told to wait when the process holds all the staging space it allows. */
const FULL_RETRY_SECONDS = 30

/** One upload. `receiving` and `ready` are live (they hold text and count against the limits); `committed` holds only a receipt. */
interface Upload {
  readonly id: string
  readonly chunkCount: number
  readonly declaredBytes: number
  state: 'receiving' | 'ready' | 'committed'
  /** The chunks by index while receiving; emptied once they are joined. */
  chunks: Array<string | undefined>
  received: number
  receivedBytes: number
  csv: string | undefined
  receipt: UploadReceipt | undefined
  expiresAt: number
}

/** What `begin` tells the caller. */
export interface BegunUpload {
  readonly uploadId: string
  readonly chunks: number
  readonly bytes: number
  /** Seconds until the upload expires unless another chunk arrives. */
  readonly expiresInSeconds: number
}

/** What `addChunk` and `finish` tell the caller about progress. */
export interface UploadProgress {
  readonly chunks: number
  readonly received: number
  readonly bytes: number
}

/**
 * In-memory staging for chunked CSV uploads: single process, keyed by user id
 * and upload id.
 *
 * A file too large for one broker message is sent as `begin` (declares the
 * chunk count and the exact size in UTF-8 bytes), any number of `chunk` calls
 * in any order, and `finish`. Every limit is checked when the data it limits
 * arrives, never only at `finish`: at most {@link MAX_LIVE_UPLOADS_PER_USER}
 * live uploads per user, at most {@link MAX_UPLOAD_BYTES} bytes and
 * {@link MAX_UPLOAD_CHUNKS} chunks each, {@link MAX_STAGED_BYTES_TOTAL} bytes
 * across all users (reserved at `begin`), and expiry {@link UPLOAD_TTL_MS}
 * after the last new chunk.
 *
 * An id that was never issued, belongs to another user, has expired or has been
 * imported gets one and the same `404`, so an id cannot be probed.
 *
 * Expiry is applied lazily on every call and by an unreferenced timer that
 * runs only while something is stored, so an idle server frees the memory and a
 * test needs no timers. The store is memory, not a database: a restart empties
 * it, and with several API processes each has its own. That is why there is no
 * migration; a shared store would be one.
 */
export class UploadStore {
  private readonly users = new Map<string, Map<string, Upload>>()
  private timer: NodeJS.Timeout | undefined
  private readonly maxLivePerUser: number
  private readonly maxTotalBytes: number
  private readonly ttlMs: number
  private readonly now: () => number

  /** @param options - Limits and clock; the defaults are the production values. */
  constructor(options: UploadStoreOptions = {}) {
    this.maxLivePerUser = options.maxLivePerUser ?? MAX_LIVE_UPLOADS_PER_USER
    this.maxTotalBytes = options.maxTotalBytes ?? MAX_STAGED_BYTES_TOTAL
    this.ttlMs = options.ttlMs ?? UPLOAD_TTL_MS
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Opens an upload.
   *
   * @param userId - The authenticated user.
   * @param chunks - How many chunks the file is sent in (1 to 64); indexes run from 0 to `chunks - 1`.
   * @param bytes - The exact size of the whole text in bytes of UTF-8 (1 to 8,000,000).
   * @returns The new upload's id and what was reserved.
   * @throws {ImportError} `400` for numbers outside the limits or that cannot fit
   *   together; `409` (`too_many_uploads`) at the per-user limit; `503`
   *   (`staging_full`, with `retryAfterSeconds`) when the process-wide limit is reached.
   */
  begin(userId: string, chunks: unknown, bytes: unknown): BegunUpload {
    this.sweep()
    const chunkCount = wholeNumber(chunks, 'chunks', 1, MAX_UPLOAD_CHUNKS, `Send the file in 1 to ${MAX_UPLOAD_CHUNKS} chunks.`)
    const declared = wholeNumber(bytes, 'bytes', 1, MAX_UPLOAD_BYTES, 'That file is larger than 8 MB. Split it and import in parts.')
    if (chunkCount > declared || declared > chunkCount * MAX_CHUNK_BYTES) {
      throw ImportError.field(['chunks'], `${chunkCount} chunks cannot hold ${declared} bytes (a chunk is 1 byte to ${MAX_CHUNK_BYTES}).`)
    }
    if (this.live(userId).length >= this.maxLivePerUser) throw tooManyUploads(this.maxLivePerUser)
    if (this.reservedBytes() + declared > this.maxTotalBytes) throw stagingFull(FULL_RETRY_SECONDS)

    const upload: Upload = {
      id: randomUUID(), chunkCount, declaredBytes: declared, state: 'receiving',
      chunks: new Array<string | undefined>(chunkCount).fill(undefined),
      received: 0, receivedBytes: 0, csv: undefined, receipt: undefined,
      expiresAt: this.now() + this.ttlMs,
    }
    let mine = this.users.get(userId)
    if (mine === undefined) this.users.set(userId, (mine = new Map()))
    mine.set(upload.id, upload)
    this.startTimer()
    return { uploadId: upload.id, chunks: chunkCount, bytes: declared, expiresInSeconds: Math.round(this.ttlMs / 1000) }
  }

  /**
   * Stores one chunk.
   *
   * A chunk may arrive in any order. Sending the same index again with the same
   * text is accepted and changes nothing (a retry); different text for an
   * index already stored is refused. Only a new chunk extends the expiry.
   *
   * @param userId - The authenticated user.
   * @param uploadId - The id `begin` returned.
   * @param index - The chunk's position, 0 to `chunks - 1`.
   * @param text - The chunk's text, 1 byte to 256 KiB of UTF-8.
   * @returns How many distinct chunks and bytes have arrived.
   * @throws {ImportError} `404` for an unknown, expired or other user's id; `400`
   *   for a bad index or text; `413` (`chunk_too_large`) over 256 KiB; `409`
   *   (`chunk_conflict`) for different text at a stored index or (`upload_finished`)
   *   a chunk after `finish`; `413` (`upload_too_large`, and the upload is
   *   discarded) when the chunks would add up to more than `begin` declared.
   */
  addChunk(userId: string, uploadId: string, index: unknown, text: unknown): UploadProgress {
    this.sweep()
    const upload = this.find(userId, uploadId)
    if (upload.state === 'committed') throw uploadNotFound()
    if (upload.state === 'ready') throw new ImportError('That upload is already finished.', 409, 'upload_finished')
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= upload.chunkCount) {
      throw ImportError.field(['index'], `Must be a whole number from 0 to ${upload.chunkCount - 1}.`)
    }
    if (typeof text !== 'string' || text.length === 0) throw ImportError.field(['text'], 'A chunk needs some text.')
    const size = utf8Length(text)
    if (size > MAX_CHUNK_BYTES) {
      throw new ImportError(`A chunk may hold at most ${MAX_CHUNK_BYTES} bytes.`, 413, 'chunk_too_large')
    }

    const stored = upload.chunks[index]
    if (stored !== undefined) {
      if (stored !== text) throw new ImportError(`Chunk ${index} was already sent with different text.`, 409, 'chunk_conflict')
      return progress(upload)
    }
    if (upload.receivedBytes + size > upload.declaredBytes) {
      this.remove(userId, uploadId)
      throw new ImportError('The chunks add up to more than the size the upload declared. Start again.', 413, 'upload_too_large')
    }
    upload.chunks[index] = text
    upload.received += 1
    upload.receivedBytes += size
    upload.expiresAt = this.now() + this.ttlMs
    return progress(upload)
  }

  /**
   * Checks that every chunk arrived and joins them.
   *
   * Checks, in order: every index from 0 to `chunks - 1` is present (a missing
   * one is a `409` and the upload stays open for it); the bytes add up to
   * exactly what `begin` declared; the joined text is well-formed Unicode (JSON
   * decoding already turned invalid UTF-8 into U+FFFD; what is left to refuse is
   * an unpaired surrogate, such as a pair cut between two chunks and never
   * completed). A failure after the first check discards the upload, since
   * sending more cannot repair it. Finishing a finished upload repeats the answer.
   *
   * @param userId - The authenticated user.
   * @param uploadId - The id `begin` returned.
   * @returns The chunk and byte counts.
   * @throws {ImportError} `404` for an unknown, expired or other user's id; `409`
   *   (`upload_incomplete`) for a missing chunk; `400` (`upload_size_mismatch`
   *   or `upload_not_text`) for the other failures.
   */
  finish(userId: string, uploadId: string): UploadProgress {
    this.sweep()
    const upload = this.find(userId, uploadId)
    if (upload.state === 'committed') throw uploadNotFound()
    if (upload.state === 'ready') return progress(upload)

    if (upload.received < upload.chunkCount) {
      const missing: number[] = []
      for (let i = 0; i < upload.chunkCount && missing.length < 5; i += 1) if (upload.chunks[i] === undefined) missing.push(i)
      const left = upload.chunkCount - upload.received
      throw new ImportError(
        `${left} of ${upload.chunkCount} chunks have not arrived (first missing: ${missing.join(', ')}).`,
        409,
        'upload_incomplete',
      )
    }
    if (upload.receivedBytes !== upload.declaredBytes) {
      this.remove(userId, uploadId)
      throw new ImportError(
        `The chunks hold ${upload.receivedBytes} bytes but the upload declared ${upload.declaredBytes}. Start again.`,
        400,
        'upload_size_mismatch',
      )
    }
    const csv = upload.chunks.join('')
    if (/\p{Surrogate}/u.test(csv) || Buffer.byteLength(csv, 'utf8') !== upload.declaredBytes) {
      this.remove(userId, uploadId)
      throw new ImportError('The uploaded text is not valid. Choose the file again.', 400, 'upload_not_text')
    }
    upload.csv = csv
    upload.chunks = []
    upload.state = 'ready'
    return progress(upload)
  }

  /**
   * Reads a finished upload for `analyze` or `commit`. Does not remove it and does not extend its expiry.
   *
   * @param userId - The authenticated user.
   * @param uploadId - The id `begin` returned.
   * @returns The text, or for an already imported upload its receipt.
   * @throws {ImportError} `404` for an unknown, expired or other user's id; `409`
   *   (`upload_incomplete`) when `finish` has not been called.
   */
  lookup(userId: string, uploadId: string): StagedUpload {
    this.sweep()
    const upload = this.find(userId, uploadId)
    if (upload.state === 'receiving') {
      throw new ImportError('That upload has not finished. Finish it before importing.', 409, 'upload_incomplete')
    }
    if (upload.state === 'committed') return { state: 'committed', receipt: upload.receipt as UploadReceipt }
    return { state: 'ready', csv: upload.csv as string }
  }

  /**
   * Records that a commit of this upload succeeded, and frees its text.
   *
   * With a receipt the entry stays, without text, for one more expiry period,
   * so a retry of the same commit (same upload, same key) can be answered from
   * the database instead of failing; at most eight receipts are kept per user.
   * Without one the entry is removed. Does nothing if the upload is already gone
   * (a commit that outlived its upload's expiry).
   *
   * @param userId - The authenticated user.
   * @param uploadId - The committed upload.
   * @param receipt - The commit's key and failed count, when it had a key.
   */
  markCommitted(userId: string, uploadId: string, receipt: UploadReceipt | undefined): void {
    const upload = this.users.get(userId)?.get(uploadId)
    if (upload === undefined) return
    if (receipt === undefined) {
      this.remove(userId, uploadId)
      return
    }
    upload.state = 'committed'
    upload.csv = undefined
    upload.chunks = []
    upload.receipt = receipt
    upload.expiresAt = this.now() + this.ttlMs
    const receipts = [...(this.users.get(userId)?.values() ?? [])].filter((u) => u.state === 'committed')
    receipts.sort((a, b) => a.expiresAt - b.expiresAt)
    for (const old of receipts.slice(0, Math.max(0, receipts.length - MAX_RECEIPTS_PER_USER))) this.remove(userId, old.id)
  }

  /** Live uploads (receiving or ready) a user holds. For tests and diagnostics. */
  liveCount(userId: string): number {
    this.sweep()
    return this.live(userId).length
  }

  /** Bytes reserved by all live uploads. For tests and diagnostics. */
  reservedBytes(): number {
    let total = 0
    for (const mine of this.users.values()) {
      for (const u of mine.values()) if (u.state !== 'committed') total += u.declaredBytes
    }
    return total
  }

  /** Entries of any state held for a user, receipts included. For tests. */
  entryCount(userId: string): number {
    this.sweep()
    return this.users.get(userId)?.size ?? 0
  }

  private live(userId: string): Upload[] {
    return [...(this.users.get(userId)?.values() ?? [])].filter((u) => u.state !== 'committed')
  }

  /** The user's upload, or the one `404` for anything else. */
  private find(userId: string, uploadId: string): Upload {
    const upload = typeof uploadId === 'string' ? this.users.get(userId)?.get(uploadId) : undefined
    if (upload === undefined) throw uploadNotFound()
    return upload
  }

  private remove(userId: string, uploadId: string): void {
    const mine = this.users.get(userId)
    if (mine === undefined) return
    mine.delete(uploadId)
    if (mine.size === 0) this.users.delete(userId)
  }

  /** Drops every expired upload, of every user, and stops the timer when nothing is left. */
  private sweep(): void {
    const now = this.now()
    for (const [userId, mine] of this.users) {
      for (const [id, upload] of mine) if (upload.expiresAt <= now) mine.delete(id)
      if (mine.size === 0) this.users.delete(userId)
    }
    if (this.users.size === 0 && this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private startTimer(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.timer.unref()
  }
}

/** Reads a whole number in range from a request field. */
function wholeNumber(value: unknown, field: string, min: number, max: number, rangeMessage: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw ImportError.field([field], `Must be a whole number, ${min} or more.`)
  }
  if (value > max) throw ImportError.field([field], rangeMessage)
  return value
}

function progress(upload: Upload): UploadProgress {
  return { chunks: upload.chunkCount, received: upload.received, bytes: upload.receivedBytes }
}
