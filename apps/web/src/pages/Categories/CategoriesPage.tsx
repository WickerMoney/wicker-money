import { useMemo } from 'react'
import { Alert } from '@wickermoney/ui-kit'
import { useActionStatus } from '../../hooks/useActionStatus.js'
import { AddCategoryForm } from './components/AddCategoryForm.js'
import { AddRuleForm } from './components/AddRuleForm.js'
import { CategoriesPanel } from './components/CategoriesPanel.js'
import { RulesPanel } from './components/RulesPanel.js'
import { StarterCategoriesPanel } from './components/StarterCategoriesPanel.js'
import { useCategoryData } from './hooks/useCategoryData.js'

/**
 * Categories and the rules that assign them.
 *
 * Core rather than a plugin: categories are a core table that every plugin
 * reads, so a fresh install with no plugins enabled still needs a way to manage
 * them.
 *
 * The two halves belong together. A rule is only useful once its category
 * exists, and the reason to write a rule is almost always a pile of
 * uncategorized transactions, which is why the rule preview matters.
 */
export function CategoriesPage() {
  const status = useActionStatus()
  const { categories, rules, reload } = useCategoryData(status)

  /** Top-level categories, the only legal parents. */
  const parents = useMemo(
    () => (categories ?? []).filter((c) => c.parent_id === null),
    [categories],
  )

  return (
    <div className="page">
      <h1 className="page__title">Categories</h1>
      {status.message !== null ? <Alert>{status.message}</Alert> : null}

      <StarterCategoriesPanel status={status} onChanged={reload} />

      <div className="page__split">
        <CategoriesPanel categories={categories} parents={parents} status={status} onChanged={reload} />
        <AddCategoryForm parents={parents} status={status} onChanged={reload} />
      </div>

      <RulesPanel rules={rules} categories={categories} status={status} onChanged={reload} />
      <AddRuleForm categories={categories} status={status} onChanged={reload} />
    </div>
  )
}
