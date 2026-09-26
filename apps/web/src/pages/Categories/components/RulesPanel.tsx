import { Button, EmptyState, Surface, Table } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, Rule } from '../../../models/index.js'
import { categoryName } from '../helpers/categoryName.js'
import { describeCondition } from '../helpers/describeCondition.js'

/** Props for {@link RulesPanel}. */
export interface RulesPanelProps {
  /** The saved rules, in resolution order. */
  readonly rules: readonly Rule[]
  /** Used to show each rule's category by name. */
  readonly categories: readonly Category[] | null
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after a rule is deleted so the list can be re-read. */
  readonly onChanged: () => Promise<void>
}

/** Lists the saved categorization rules and lets the user delete them. */
export function RulesPanel({ rules, categories, status, onChanged }: RulesPanelProps) {
  const removeRule = async (id: string) => {
    status.show(null)
    try {
      await api.del(`/category-rules/${id}`)
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not delete that rule.')
    }
  }

  return (
    <Surface title="Rules">
      {rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          hint="A rule categorizes matching transactions automatically, at import and on entry."
        />
      ) : (
        <Table
          columns={[
            { key: 'cat', header: 'Category', render: (r: Rule) => categoryName(categories, r.category_id) },
            {
              key: 'conditions', header: 'Matches when',
              render: (r: Rule) => (
                <ul className="rule-conditions">
                  {r.conditions.map((c, i) => (
                    <li key={c.id}>
                      {i > 0 ? <span className="rule-conditions__and">and </span> : null}
                      <code>{describeCondition(c)}</code>
                    </li>
                  ))}
                </ul>
              ),
            },
            { key: 'prio', header: 'Priority', numeric: true, render: (r: Rule) => String(r.priority) },
            { key: 'del', header: '',
              render: (r: Rule) => <Button onClick={() => void removeRule(r.id)}>Delete</Button> },
          ]}
          rows={rules}
          rowKey={(r) => r.id}
        />
      )}
      <p className="form-hint">
        Every condition on a rule must match — that's how "merchant contains CHECK and amount is
        exactly 375.00" stays separate from other cheques. Ties resolve by priority, then by
        which rule has more conditions (a more specific rule wins over a more general one at the
        same priority), then by which rule was written first.
      </p>
    </Surface>
  )
}
