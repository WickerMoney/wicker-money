/** A row in some other schema (for example a plugin table) that references a category. */
export interface FakeExternalReference {
  userId: string
  /** Schema-qualified table name, as usage reporting names it. */
  table: string
  categoryId: string
}
