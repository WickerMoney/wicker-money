/** One link between an import batch and a transaction it created. */
export interface ExportedBatchTransaction {
  readonly batch_id: string
  readonly transaction_id: string
}
