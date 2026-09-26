import type { SourceMapping } from '../../shared/index.js'

/** What analysing or committing a file needs: where it goes, its text, and how to read it. */
export interface AnalyzeInput {
  /** The account the file would be imported into. */
  readonly accountId: string
  /** The CSV text. */
  readonly csv: string
  /** How to read the file. */
  readonly mapping: SourceMapping
}
