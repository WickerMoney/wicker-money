/** The longest name a saved mapping may have. */
export const MAX_SOURCE_NAME = 120

/** One problem with a mapping, on the request field it is about. */
export interface MappingIssue {
  /** The field, as the request body spells it (`['columns', 'date']`). */
  readonly path: readonly string[]
  /** A sentence about that field that does not repeat its name. */
  readonly message: string
}

/**
 * The mapping rules the page checks before sending and the server enforces,
 * in one place, so the two refuse the same things in the same words.
 *
 * Only what a person chooses or types is checked here: the name the mapping
 * is remembered by, and the two columns no row can be read without. Whether
 * the date format and amount style are known values is the server's own
 * type check, since the page only offers known ones.
 *
 * @param mapping - The source name and chosen columns.
 * @returns Every problem found, empty when the mapping can be sent.
 */
export function mappingIssues(mapping: {
  readonly sourceName: string
  readonly columns: { readonly date?: string | undefined; readonly merchant?: string | undefined }
}): MappingIssue[] {
  const issues: MappingIssue[] = []
  const name = mapping.sourceName.trim()
  if (name === '') issues.push({ path: ['sourceName'], message: 'Give this file’s layout a name, so it can be used again.' })
  else if (name.length > MAX_SOURCE_NAME) {
    issues.push({ path: ['sourceName'], message: `Must be ${MAX_SOURCE_NAME} characters or fewer.` })
  }
  if ((mapping.columns.date ?? '') === '') issues.push({ path: ['columns', 'date'], message: 'Choose the date column.' })
  if ((mapping.columns.merchant ?? '') === '') {
    issues.push({ path: ['columns', 'merchant'], message: 'Choose the description column.' })
  }
  return issues
}
