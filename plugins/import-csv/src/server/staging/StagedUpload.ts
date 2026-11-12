import type { UploadReceipt } from './UploadReceipt.js'

/** What `lookup` hands the commit and analyze routes for a finished upload. */
export type StagedUpload =
  | { readonly state: 'ready'; readonly csv: string }
  | { readonly state: 'committed'; readonly receipt: UploadReceipt }
