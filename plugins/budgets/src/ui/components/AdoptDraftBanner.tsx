import { Button } from '@wickermoney/ui-kit'
import { monthLabel } from '../helpers/monthLabel.js'

/** Props for {@link AdoptDraftBanner}. */
export interface AdoptDraftBannerProps {
  readonly monthKey: string
  readonly busy: boolean
  /** Saves the previewed lines as this month's budget. */
  readonly onAdopt: () => void
}

/** Offers to save a month's previewed lines, explaining that nothing is saved until then. */
export function AdoptDraftBanner({ monthKey, busy, onAdopt }: AdoptDraftBannerProps) {
  return (
    <div className="bud__actions">
      <Button variant="primary" disabled={busy} onClick={onAdopt}>
        {busy ? 'Starting…' : `Start ${monthLabel(monthKey)} from these`}
      </Button>
      <p className="bud__note">
        These are last month&rsquo;s lines, shown so you can see the shape of the month.
        Nothing is saved until you accept them or edit one.
      </p>
    </div>
  )
}
