import { useMemo } from 'react'
import { Button, EmptyState, IconButton, Surface, Table } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import { DisclosureButton, useExpandedGroups } from '../../../disclosure/index.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, Rule } from '../../../models/index.js'
import { describeCondition } from '../helpers/describeCondition.js'
import { groupRulesByCategory } from '../helpers/groupRulesByCategory.js'

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

/**
 * Lists the saved categorization rules, one collapsible group per category, and
 * lets the user delete them.
 *
 * Rules pile up (one per merchant is normal), so a flat table makes the page
 * as long as the rule list. Grouped and closed, the page is as long as the
 * number of categories that have rules, and "what does Groceries match?" is one
 * click. Priority still reads across the whole list: a rule's priority is
 * shown on each row, and groups are only a view.
 */
export function RulesPanel({ rules, categories, status, onChanged }: RulesPanelProps) {
  const groups = useExpandedGroups()
  const ruleGroups = useMemo(() => groupRulesByCategory(rules, categories), [rules, categories])

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
        <>
          <div className="acc-toolbar">
            <span className="wm-muted acc-toolbar__summary">
              {rules.length} {rules.length === 1 ? 'rule' : 'rules'} in {ruleGroups.length}{' '}
              {ruleGroups.length === 1 ? 'category' : 'categories'}
            </span>
            {ruleGroups.length > 1 ? (
              <div className="acc-toolbar__actions">
                <Button onClick={() => groups.expandAll(ruleGroups.map((g) => g.categoryId))}>Expand all</Button>
                <Button onClick={groups.collapseAll}>Collapse all</Button>
              </div>
            ) : null}
          </div>

          <div className="acc">
            {ruleGroups.map((g) => {
              const open = groups.isOpen(g.categoryId)
              const panelId = `rules-${g.categoryId}`
              return (
                <section className="acc__group" key={g.categoryId}>
                  <h3 className="acc__heading">
                    <DisclosureButton expanded={open} onToggle={() => groups.toggle(g.categoryId)} controls={panelId}>
                      <span className="acc__title">{g.name}</span>
                      <span className="acc__count">
                        {g.rules.length} {g.rules.length === 1 ? 'rule' : 'rules'}
                      </span>
                    </DisclosureButton>
                  </h3>
                  <div id={panelId} className="acc__panel" hidden={!open}>
                    {open ? (
                      <Table
                        caption="Rules"
                        columns={[
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
                            render: (r: Rule) => (
                              <div className="wm-row-actions">
                                <IconButton
                                  icon="delete" label="Delete" variant="danger" disabled={status.busy}
                                  onClick={() => void removeRule(r.id)}
                                />
                              </div>
                            ) },
                        ]}
                        rows={g.rules}
                        rowKey={(r) => r.id}
                      />
                    ) : null}
                  </div>
                </section>
              )
            })}
          </div>
        </>
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
