import type { MappingBody } from './MappingBody.js'

/** The unvalidated request body of the analyze endpoint: the target account, the file, and its mapping. */
export type AnalyzeBody = { accountId?: unknown; csv?: unknown } & MappingBody
