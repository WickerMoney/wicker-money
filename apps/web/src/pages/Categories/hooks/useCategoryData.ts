import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import { useOnboarding } from '../../../onboarding/useOnboarding.js'
import type { Category, Rule } from '../../../models/index.js'

/** What {@link useCategoryData} returns. */
export interface CategoryData {
  /** `null` until the first load completes. */
  readonly categories: Category[] | null
  /** The user's rules, in resolution order. */
  readonly rules: Rule[]
  /** Re-reads categories and rules from the API. */
  readonly reload: () => Promise<void>
}

/**
 * Loads the user's categories and categorization rules, and reloads them
 * whenever the setup wizard changes what exists.
 *
 * The wizard creates categories through its own endpoint, so without the
 * reload on `onboardedAt` and `categoryCount` the list behind the wizard would
 * keep showing the state from before it opened.
 *
 * @param status - Receives the message when the load fails.
 * @returns The categories and rules, and a function to reload them.
 */
export function useCategoryData(status: ActionStatus): CategoryData {
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const { status: onboarding } = useOnboarding()
  const { show } = status

  const latest = useLatestRequest()

  const reload = useCallback(
    () => latest.run(
      (signal) => Promise.all([
        api.get<Category[]>('/categories', { signal }),
        api.get<Rule[]>('/category-rules', { signal }),
      ]),
      ([cats, rs]) => {
        setCategories(cats)
        setRules(rs)
      },
    ),
    [latest],
  )

  useEffect(() => {
    void reload().catch((e: unknown) => {
      show(e instanceof Error ? e.message : 'Could not load categories.')
    })
    return latest.cancel
  }, [reload, latest, show, onboarding?.onboardedAt, onboarding?.categoryCount])

  return { categories, rules, reload }
}
