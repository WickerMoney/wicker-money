import { z } from 'zod'

/** Request body for creating one category. */
export const categoryBody = z.object({
  name: z.string().trim().min(1).max(100),
  /**
   * Lowercased before validation, not merely required to be lowercase.
   *
   * The unique index is on the raw slug, so 'travel' and 'TRAVEL' would
   * otherwise be two categories, splitting spending across both in every chart
   * and giving budgets two lines for one thing. Normalising here lets the
   * existing index do the job with no second index and no rewrite of data.
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Use only lowercase letters, numbers and hyphens.')),
  parentId: z.string().uuid().nullish(),
  icon: z.string().max(50).nullish(),
  sortOrder: z.number().int().default(0),
  /**
   * What this category means for cash flow.
   *
   * A `transfer` category is excluded from spending and income everywhere,
   * which stops a credit-card payment being counted as spending every month.
   */
  kind: z.enum(['expense', 'income', 'transfer']).default('expense'),
})
