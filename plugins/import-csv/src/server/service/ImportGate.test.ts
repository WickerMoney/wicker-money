import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportBusyError } from './ImportBusyError.js'
import { ImportGate } from './ImportGate.js'

/** A job that stays running until `finish()` is called. */
function pending() {
  let finish!: () => void
  const done = new Promise<void>((resolve) => { finish = resolve })
  return { done, finish }
}

describe('ImportGate', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('rejects a limit or wait it cannot honour', () => {
    expect(() => new ImportGate(0, 1000)).toThrow('positive integer')
    expect(() => new ImportGate(1.5, 1000)).toThrow('positive integer')
    expect(() => new ImportGate(1, -1)).toThrow('negative')
  })

  it('never runs more jobs at once than its limit, and the rest take turns in arrival order', async () => {
    const gate = new ImportGate(2, 60_000)
    const started: number[] = []
    const jobs = [1, 2, 3, 4].map(() => pending())
    const runs = jobs.map((job, n) => gate.run(async () => { started.push(n); await job.done; return n }))
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 1])

    jobs[0]?.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 1, 2])
    jobs[1]?.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 1, 2, 3])
    jobs[2]?.finish()
    jobs[3]?.finish()
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3])
  })

  it('refuses a request that waited out its time, and leaves the others untouched', async () => {
    const gate = new ImportGate(1, 10_000)
    const first = pending()
    const running = gate.run(() => first.done)
    const waiter = gate.run(() => Promise.resolve('late'))
    const outcome = waiter.then(() => 'ran', (error: unknown) => error)

    await vi.advanceTimersByTimeAsync(9_999)
    let settled = false
    void outcome.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const error = await outcome
    expect(error).toBeInstanceOf(ImportBusyError)
    expect(error).toMatchObject({ statusCode: 503, code: 'import_busy', retryAfterSeconds: 10 })

    first.finish()
    await running
    // The refused request left no stale waiter behind to take the next slot.
    await expect(gate.run(() => Promise.resolve('next'))).resolves.toBe('next')
  })

  it('refuses at once when the wait is 0 and every slot is busy', async () => {
    const gate = new ImportGate(1, 0)
    const first = pending()
    const running = gate.run(() => first.done)
    await expect(gate.run(() => Promise.resolve())).rejects.toMatchObject({
      statusCode: 503, code: 'import_busy', retryAfterSeconds: 5,
    })
    first.finish()
    await running
    await expect(gate.run(() => Promise.resolve('free'))).resolves.toBe('free')
  })

  it('suggests a retry time between 5 and 30 seconds', async () => {
    const hold = pending()
    const long = new ImportGate(1, 120_000)
    const slow = long.run(() => hold.done)
    const waiter = long.run(() => Promise.resolve()).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await waiter).toMatchObject({ retryAfterSeconds: 30 })
    hold.finish()
    await slow
  })

  it('frees the slot when a job fails', async () => {
    const gate = new ImportGate(1, 1000)
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(gate.run(() => Promise.resolve('next'))).resolves.toBe('next')
  })
})
