import { Button } from '@wickermoney/ui-kit'

/** Props for {@link WizardFooter}. */
export interface WizardFooterProps {
  /** What the current selection would create, e.g. `61 categories across 18 groups`, or `null`. */
  readonly summary: string | null
  /** `true` on the first step, where Back is disabled. */
  readonly first: boolean
  /** `true` on the last step, where Next becomes the finish button. */
  readonly last: boolean
  /** `true` while the finish request is in flight. */
  readonly busy: boolean
  /** Called for Back. */
  readonly onBack: () => void
  /** Called for Next. */
  readonly onNext: () => void
  /** Called for the finish button. */
  readonly onFinish: () => void
}

/** The wizard's running total and its Back, Next and finish buttons. */
export function WizardFooter({ summary, first, last, busy, onBack, onNext, onFinish }: WizardFooterProps) {
  return (
    <footer className="wiz__foot">
      <span className="wiz__count">{summary ?? ' '}</span>
      <div className="wiz__nav">
        <Button disabled={first || busy} onClick={onBack}>Back</Button>
        {last ? (
          <Button variant="primary" disabled={busy} onClick={onFinish}>
            {busy ? 'Creating…' : 'Create categories'}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={onNext}>Next</Button>
        )}
      </div>
    </footer>
  )
}
