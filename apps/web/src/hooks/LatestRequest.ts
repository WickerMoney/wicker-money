/** What {@link useLatestRequest} returns. */
export interface LatestRequest {
  /**
   * Starts a request, superseding any earlier one from the same owner.
   *
   * The earlier request is aborted and, even if its response arrives anyway,
   * its `apply` is never called. Only the most recently started request may
   * apply its result.
   *
   * @param load - Performs the request; pass the signal on to the API call.
   * @param apply - Receives the result, and only if the request is still the latest.
   * @returns A promise that resolves once the request is applied or superseded.
   * A request that was superseded never rejects.
   * @throws {Error} Whatever `load` rejected with, when the request was still the latest.
   */
  readonly run: <T>(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) => Promise<void>
  /** Aborts the request in flight, if any, so its result is discarded. */
  readonly cancel: () => void
}
