import { useState, type FormEvent } from 'react'
import {
  Button, CategoryOptions, EmptyState, Field, FormError, SelectField, Surface, formErrorsFrom, hasFormErrors,
  useFormErrors,
} from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, RulePreview } from '../../../models/index.js'
import { isConditionComplete, newConditionDraft, toConditionBody } from '../helpers/conditionDraft.js'
import { checkRule, conditionField } from '../helpers/ruleChecks.js'
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
 *
 * Values are checked in the browser first, with the API's rules, and every
 * problem (the browser's or the server's) is shown under the field it is
 * about; anything not about one field is shown beside the buttons.
 */
export function AddRuleForm({ categories, status, onChanged }: AddRuleFormProps) {
  const [ruleCategoryId, setRuleCategoryId] = useState('')
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => [newConditionDraft()])
  const [priority, setPriority] = useState('0')
  const [applyToExisting, setApplyToExisting] = useState(false)
  const [preview, setPreview] = useState<RulePreview | null>(null)
  const form = useFormErrors()

  // Until the user picks one, the first category is the selection.
  const selectedCategoryId = ruleCategoryId === '' ? (categories?.[0]?.id ?? '') : ruleCategoryId

  const updateCondition = (key: string, patch: Partial<ConditionDraft>) => {
    setConditions((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
    for (const field of Object.keys(patch)) form.clearField(`${key}.${field}`)
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

  /** Maps a server path (`conditions.0.amountMin`) to the field it names in this form. */
  const fieldFor = (path: string): string | undefined => {
    if (path === 'categoryId' || path === 'priority') return path
    const match = /^conditions\.(\d+)\.(\w+)$/.exec(path)
    const row = match === null ? undefined : conditions[Number(match[1])]
    return row === undefined || match === null ? undefined : conditionField(row, match[2] as string)
  }

  /** The request body, or `null` after showing what is wrong with the form. */
  const ruleBody = () => {
    const problems = checkRule(priority, conditions)
    form.show(problems)
    if (hasFormErrors(problems)) return null
    return {
      categoryId: selectedCategoryId,
      priority: Number(priority),
      applyToExisting,
      conditions: conditions.map(toConditionBody),
    }
  }

  const runPreview = async () => {
    const body = ruleBody()
    if (body === null) return
    status.begin()
    try {
      setPreview(await api.post<RulePreview>('/category-rules/preview', body))
    } catch (e) {
      form.show(formErrorsFrom(e, fieldFor, 'Could not preview that rule.'))
    } finally { status.end() }
  }

  const addRule = async (event: FormEvent) => {
    event.preventDefault()
    const body = ruleBody()
    if (body === null) return
    status.begin()
    try {
      const r = await api.post<{ recategorized: number }>('/category-rules', body)
      setConditions([newConditionDraft()])
      setPreview(null)
      status.show(r.recategorized > 0 ? `Rule saved. ${r.recategorized} existing transactions recategorized.` : null)
      await onChanged()
    } catch (e) {
      form.show(formErrorsFrom(e, fieldFor, 'Could not save that rule.'))
    } finally { status.end() }
  }

  const busy = status.busy

  return (
    <Surface title="Add a rule">
      {categories === null || categories.length === 0 ? (
        <EmptyState title="Add a category first" hint="A rule has to assign something." />
      ) : (
        <form onSubmit={addRule} ref={form.ref} noValidate>
          <div className="page__row">
            <SelectField label="Category" value={selectedCategoryId} error={form.errors.fields['categoryId']}
                         onChange={(e) => { setRuleCategoryId(e.target.value); setPreview(null) }}>
              {/* Grouped, and enabled only: a rule filing transactions into a
                  category hidden from every picker would be a surprise. */}
              <CategoryOptions categories={categories.filter((c) => c.is_enabled)} />
            </SelectField>
            <Field label="Priority" inputMode="numeric" value={priority} error={form.errors.fields['priority']}
                   onChange={(e) => { setPriority(e.target.value); form.clearField('priority') }} />
          </div>

          <div className="rule-condition-list">
            {conditions.map((c, i) => (
              <ConditionRow
                key={c.key}
                condition={c}
                index={i}
                removable={conditions.length > 1}
                errors={{
                  textValue: form.errors.fields[conditionField(c, 'textValue')],
                  amountValue: form.errors.fields[conditionField(c, 'amountValue')],
                  amountMin: form.errors.fields[conditionField(c, 'amountMin')],
                  amountMax: form.errors.fields[conditionField(c, 'amountMax')],
                }}
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
          <FormError message={form.errors.form} />

          {preview !== null ? (
            <RulePreviewNote preview={preview} applyToExisting={applyToExisting} />
          ) : null}
        </form>
      )}
    </Surface>
  )
}
