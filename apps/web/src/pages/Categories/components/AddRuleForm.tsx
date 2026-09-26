import { useState, type FormEvent } from 'react'
import { Button, CategoryOptions, EmptyState, Field, SelectField, Surface } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, RulePreview } from '../../../models/index.js'
import { isConditionComplete, newConditionDraft, toConditionBody } from '../helpers/conditionDraft.js'
import type { ConditionDraft } from '../state/ConditionDraft.js'
import { ConditionRow } from './ConditionRow.js'
import { RulePreviewNote } from './RulePreviewNote.js'

/** Props for {@link AddRuleForm}. */
export interface AddRuleFormProps {
  /** `null` while the first load is in flight. */
  readonly categories: readonly Category[] | null
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after a rule is saved so the list can be re-read. */
  readonly onChanged: () => Promise<void>
}

/**
 * A form that builds and saves one categorization rule.
 *
 * Every condition must match (AND only); a "preview" button reports how many
 * transactions the rule would touch before it is saved, because "apply to
 * existing transactions" is opt-in and cannot be judged from the rule text alone.
 */
export function AddRuleForm({ categories, status, onChanged }: AddRuleFormProps) {
  const [ruleCategoryId, setRuleCategoryId] = useState('')
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => [newConditionDraft()])
  const [priority, setPriority] = useState('0')
  const [applyToExisting, setApplyToExisting] = useState(false)
  const [preview, setPreview] = useState<RulePreview | null>(null)

  // Until the user picks one, the first category is the selection.
  const selectedCategoryId = ruleCategoryId === '' ? (categories?.[0]?.id ?? '') : ruleCategoryId

  const updateCondition = (key: string, patch: Partial<ConditionDraft>) => {
    setConditions((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
    setPreview(null)
  }
  const addCondition = () => { setConditions((cs) => [...cs, newConditionDraft()]); setPreview(null) }
  const removeCondition = (key: string) => {
    // A rule needs at least one condition, so the last row has no remove button
    // in the first place; this is a defensive floor to match.
    setConditions((cs) => (cs.length <= 1 ? cs : cs.filter((c) => c.key !== key)))
    setPreview(null)
  }
  const conditionsReady = conditions.length > 0 && conditions.every(isConditionComplete)

  const runPreview = async () => {
    status.begin()
    try {
      const r = await api.post<RulePreview>('/category-rules/preview', {
        categoryId: selectedCategoryId,
        priority: Number(priority),
        applyToExisting,
        conditions: conditions.map(toConditionBody),
      })
      setPreview(r)
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not preview that rule.')
    } finally { status.end() }
  }

  const addRule = async (event: FormEvent) => {
    event.preventDefault()
    status.begin()
    try {
      const r = await api.post<{ recategorized: number }>('/category-rules', {
        categoryId: selectedCategoryId,
        priority: Number(priority),
        applyToExisting,
        conditions: conditions.map(toConditionBody),
      })
      setConditions([newConditionDraft()])
      setPreview(null)
      status.show(r.recategorized > 0 ? `Rule saved. ${r.recategorized} existing transactions recategorized.` : null)
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not save that rule.')
    } finally { status.end() }
  }

  const busy = status.busy

  return (
    <Surface title="Add a rule">
      {categories === null || categories.length === 0 ? (
        <EmptyState title="Add a category first" hint="A rule has to assign something." />
      ) : (
        <form onSubmit={addRule}>
          <div className="page__row">
            <SelectField label="Category" value={selectedCategoryId}
                         onChange={(e) => { setRuleCategoryId(e.target.value); setPreview(null) }}>
              {/* Grouped, and enabled only: a rule filing transactions into a
                  category hidden from every picker would be a surprise. */}
              <CategoryOptions categories={categories.filter((c) => c.is_enabled)} />
            </SelectField>
            <Field label="Priority" inputMode="numeric" value={priority}
                   onChange={(e) => setPriority(e.target.value)} />
          </div>

          <div className="rule-condition-list">
            {conditions.map((c, i) => (
              <ConditionRow
                key={c.key}
                condition={c}
                index={i}
                removable={conditions.length > 1}
                onChange={(patch) => updateCondition(c.key, patch)}
                onRemove={() => removeCondition(c.key)}
              />
            ))}
            <div className="page__actions">
              <Button onClick={addCondition}>+ And another condition</Button>
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={applyToExisting}
                   onChange={(e) => { setApplyToExisting(e.target.checked); setPreview(null) }} />
            <span>
              Also apply to transactions already recorded. Categories you set by hand are never
              overwritten.
            </span>
          </label>

          <div className="page__actions">
            <Button disabled={busy || !conditionsReady} onClick={() => void runPreview()}>
              {busy ? 'Checking…' : 'Preview'}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !conditionsReady}>
              Save rule
            </Button>
          </div>

          {preview !== null ? (
            <RulePreviewNote preview={preview} applyToExisting={applyToExisting} />
          ) : null}
        </form>
      )}
    </Surface>
  )
}
