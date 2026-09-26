import type { PendingPromise } from './PendingPromise.js'

/** @returns A pending promise together with the functions that settle it. */
export function deferred<T>(): PendingPromise<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
