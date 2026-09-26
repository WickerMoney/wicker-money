import type { MappingBody } from './MappingBody.js'

/** The unvalidated request body of the commit endpoint: the analyze fields plus file name and accepted rows. */
export type CommitBody = {
  accountId?: unknown
  csv?: unknown
  fileName?: unknown
  acceptRowNumbers?: unknown
  idempotencyKey?: unknown
} & MappingBody
