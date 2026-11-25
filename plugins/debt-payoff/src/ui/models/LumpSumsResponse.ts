import type { LumpSum } from './LumpSum.js'

/** `GET /lump-sums`. */
export interface LumpSumsResponse {
  readonly lumpSums: readonly LumpSum[]
}
