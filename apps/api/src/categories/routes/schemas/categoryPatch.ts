import { z } from 'zod'

/** Request body for editing a category. At least one field must be present. */
export const categoryPatch = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    /** `null` moves the category to the top level. */
    parentId: z.string().uuid().nullable().optional(),
    icon: z.string().max(50).nullable().optional(),
    isEnabled: z.boolean().optional(),
    kind: z.enum(['expense', 'income', 'transfer']).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.')
