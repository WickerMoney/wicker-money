import { useMemo, useState } from 'react'
import { Alert, Button, Dialog } from '@wickermoney/ui-kit'
import { useExpandedGroups } from '../../disclosure/index.js'
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
 * Adding a category or a rule opens a dialog, as on the Transactions page.
 *
 * The two halves belong together. A rule is only useful once its category
 * exists, and the reason to write a rule is almost always a pile of
 * uncategorized transactions, which is why the rule preview matters.
 */
export function CategoriesPage() {
  const status = useActionStatus()
  const { categories, rules, reload } = useCategoryData(status)
  // Owned here so adding a child can open its parent in the table beside the form.
  const groups = useExpandedGroups()
  const [adding, setAdding] = useState<'category' | 'rule' | null>(null)

  /** Top-level categories, the only legal parents. */
  const parents = useMemo(
    () => (categories ?? []).filter((c) => c.parent_id === null),
    [categories],
  )

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Categories</h1>
        <div className="page__actions page__actions--tight">
          <Button onClick={() => setAdding('rule')}>Add rule</Button>
          <Button variant="primary" onClick={() => setAdding('category')}>Add category</Button>
        </div>
      </div>
      {status.message !== null ? <Alert>{status.message}</Alert> : null}

      <StarterCategoriesPanel status={status} onChanged={reload} />

      <CategoriesPanel categories={categories} parents={parents} status={status} onChanged={reload} groups={groups} />

      <RulesPanel rules={rules} categories={categories} status={status} onChanged={reload} />

      {adding === 'category' ? (
        <Dialog title="Add a category" onClose={() => setAdding(null)}>
          <AddCategoryForm
            parents={parents}
            status={status}
            onChanged={async () => { await reload(); setAdding(null) }}
            onCreated={(parentId) => { if (parentId !== null) groups.expand(parentId) }}
          />
        </Dialog>
      ) : null}
      {adding === 'rule' ? (
        <Dialog title="Add a rule" onClose={() => setAdding(null)}>
          <AddRuleForm
            categories={categories}
            status={status}
            onChanged={async () => { await reload(); setAdding(null) }}
          />
        </Dialog>
      ) : null}
    </div>
  )
}
