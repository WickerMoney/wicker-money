import { useState, type FormEvent } from 'react'
import { Button, Field, SelectField, Surface } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category } from '../../../models/index.js'
import { slugify } from '../helpers/slugify.js'

/** Props for {@link AddCategoryForm}. */
export interface AddCategoryFormProps {
  /** Top-level categories, offered as the possible parent. */
  readonly parents: readonly Category[]
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after a category is created so the list can be re-read. */
  readonly onChanged: () => Promise<void>
}

/** A form that creates one category. The slug is derived from the name, never typed. */
export function AddCategoryForm({ parents, status, onChanged }: AddCategoryFormProps) {
  const [name, setName] = useState('')
  const [newParentId, setNewParentId] = useState('')
  const [newKind, setNewKind] = useState<Category['kind']>('expense')

  const addCategory = async (event: FormEvent) => {
    event.preventDefault()
    status.begin()
    try {
      await api.post('/categories', {
        name: name.trim(),
        slug: slugify(name),
        parentId: newParentId === '' ? null : newParentId,
        kind: newKind,
      })
      setName('')
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not add that category.')
    } finally { status.end() }
  }

  return (
    <Surface title="Add a category">
      <form onSubmit={addCategory}>
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Groceries" />
        <SelectField
          label="Under"
          value={newParentId}
          onChange={(e) => setNewParentId(e.target.value)}
        >
          <option value="">Top level</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <SelectField
          label="Counts as"
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as Category['kind'])}
        >
          <option value="expense">Spending</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer — excluded from both</option>
        </SelectField>
        {name.trim() !== '' ? <p className="form-hint">Saved as {slugify(name)}</p> : null}
        <Button type="submit" variant="primary" disabled={status.busy || name.trim() === ''}>
          {status.busy ? 'Saving…' : 'Add category'}
        </Button>
      </form>
    </Surface>
  )
}
