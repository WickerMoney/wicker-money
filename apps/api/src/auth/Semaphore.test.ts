import { describe, expect, it } from 'vitest'
import { Semaphore } from './Semaphore.js'

/** Resolves after the event loop has turned a few times. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

describe('Semaphore', () => {
  it('never runs more jobs at once than its limit', async () => {
    const semaphore = new Semaphore(2)
    let running = 0
    let peak = 0
    const job = async () => {
      running += 1
      peak = Math.max(peak, running)
      await tick()
      running -= 1
    }
    await Promise.all(Array.from({ length: 8 }, () => semaphore.run(job)))
    expect(peak).toBe(2)
  })

  it('runs waiting jobs in arrival order', async () => {
    const semaphore = new Semaphore(1)
    const order: number[] = []
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        semaphore.run(async () => {
          await tick()
          order.push(n)
        }),
      ),
    )
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('frees the slot when a job fails', async () => {
    const semaphore = new Semaphore(1)
    await expect(semaphore.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(semaphore.run(() => Promise.resolve('next'))).resolves.toBe('next')
  })

  it('rejects a limit below one', () => {
    expect(() => new Semaphore(0)).toThrow()
  })
})
