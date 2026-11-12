/** What the store keeps of an upload after its commit succeeded: enough to answer a retry of that commit. */
export interface UploadReceipt {
  /** The idempotency key the commit carried. */
  readonly idempotencyKey: string
  /** Rows of the file that could not be mapped, as the first commit counted them. */
  readonly failed: number
}
