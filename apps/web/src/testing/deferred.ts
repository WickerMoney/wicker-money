/** A promise whose resolution the test controls. */
export interface Deferred<T> {
  /** The pending promise. */
  readonly promise: Promise<T>
  /** Settles the promise with a value. */
  readonly resolve: (value: T) => void
  /** Settles the promise with an error. */
  readonly reject: (error: unknown) => void
}

/**
 * Creates a promise that stays pending until the test settles it, for driving
 * responses that arrive out of order.
 *
 * @returns The promise with its `resolve` and `reject`.
 */
export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
