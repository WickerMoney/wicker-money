/** A promise whose settlement the test controls. */
export interface PendingPromise<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: Error) => void
}
