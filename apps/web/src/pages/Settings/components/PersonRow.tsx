import { SelectField } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import type { Person } from '../../../models/index.js'

/** Props for {@link PersonRow}. */
export interface PersonRowProps {
  /** The account to show. */
  readonly person: Person
  /** True when this is the signed-in user. */
  readonly isSelf: boolean
  /** True while this account's change is being saved. */
  readonly saving: boolean
  /** The last failed change for this account, shown on its role field. */
  readonly error: string | null
  /** Called with the role the owner picked. The row keeps showing the current role until the caller updates it. */
  readonly onChange: (role: 'owner' | 'member') => void
}

/**
 * One account in the People section: its email, when it joined, and a role select.
 *
 * The select is named for the account ("Role for a@example.com") so a screen
 * reader's list of form fields tells the rows apart; the visible label stays
 * the short "Role". It is controlled, so choosing a different role does not
 * change what it shows until the caller has saved it (or the owner has
 * confirmed a demotion).
 *
 * While a change is saving the select is `aria-disabled`, not `disabled`: a
 * disabled control drops keyboard focus, which would send a keyboard or
 * screen-reader user back to the top of the page after every change. The
 * caller ignores changes made meanwhile.
 */
export function PersonRow({ person, isSelf, saving, error, onChange }: PersonRowProps) {
  return (
    <li className="people-row" aria-busy={saving}>
      <div className="people-row__who">
        <span className="people-row__email">{person.email}</span>
        {isSelf ? <span className="tag">you</span> : null}
        <span className="people-row__joined wm-muted">Joined <time dateTime={person.createdAt}>{formatDate(person.createdAt)}</time></span>
      </div>
      <div className="people-row__role">
        <SelectField
          label="Role"
          aria-label={`Role for ${person.email}`}
          value={person.role}
          error={error ?? undefined}
          aria-disabled={saving ? true : undefined}
          onChange={(e) => { onChange(e.target.value === 'owner' ? 'owner' : 'member') }}
        >
          <option value="owner">Owner</option>
          <option value="member">Member</option>
        </SelectField>
        {saving ? <span className="wm-muted">Saving…</span> : null}
      </div>
    </li>
  )
}
