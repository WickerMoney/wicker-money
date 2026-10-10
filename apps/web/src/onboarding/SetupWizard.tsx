import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Spinner, useFocusTrap } from '@wickermoney/ui-kit'
import { api } from '../api/client.js'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import type { SituationGroup } from './SituationGroup.js'
import { useOnboarding } from './useOnboarding.js'
import { useSetupPreview } from './useSetupPreview.js'
import { useWizardAnswers } from './useWizardAnswers.js'
import { WizardFooter } from './WizardFooter.js'
import { WizardHeader } from './WizardHeader.js'
import { WizardProgress } from './WizardProgress.js'
import { WizardStep } from './WizardStep.js'

/**
 * First-run setup, as a modal over whatever the user landed on.
 *
 * A wizard rather than a page because it has exactly one exit that matters —
 * finishing — and because the thing it produces (a category list) is not worth
 * a permanent route once it has been produced. It is skippable: a person who
 * wants to start from an empty list should not have to answer thirty questions
 * to get there.
 *
 * The questions come from the server. A checkbox invented here would tick, look
 * correct, and create nothing.
 */
export function SetupWizard() {
  const { status, open, dismiss, refresh } = useOnboarding()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const { chosen, toggle } = useWizardAnswers(open, status)
  const preview = useSetupPreview(open, chosen)

  const groups: readonly SituationGroup[] = status?.groups ?? []

  useEffect(() => {
    if (open) {
      setStep(0)
      setError(null)
    }
  }, [open, status])

  // Escape closes it, like every other modal on the web. Without this the only
  // way out is the button, which is a trap on a keyboard.
  useEscapeKey(open, dismiss)

  // Tab stays inside the dialog, and focus goes back to whatever had it before
  // the wizard opened once it closes.
  useFocusTrap(panel, open)

  const ready = status !== null && status.groups.length > 0

  // Focus moves only when the step changes (or the content first appears), not
  // on every render, so ticking a box never throws the user back to the top.
  // The heading is what a screen reader should announce for the new step; the
  // panel itself holds focus while the questions are still loading.
  useEffect(() => {
    if (!open) return
    if (ready) heading.current?.focus()
    else panel.current?.focus()
  }, [open, ready, step])

  const finish = useCallback(async (situations: readonly string[]) => {
    setBusy(true); setError(null)
    try {
      await api.post('/onboarding/complete', { situations })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish setup.')
    } finally { setBusy(false) }
  }, [refresh])

  if (!open) return null

  const total = groups.length
  const summary = preview === null ? null : `${preview.total} categories across ${preview.parents} groups`

  return (
    <div className="wiz" role="presentation">
      <div
        className="wiz__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ready ? 'wiz-title' : undefined}
        aria-label={ready ? undefined : 'Setup'}
        tabIndex={-1}
        ref={panel}
      >
        {status === null || total === 0 ? (
          <div className="wiz__body"><Spinner label="Loading setup" /></div>
        ) : (
          <>
            <WizardHeader step={step} groups={groups} onDismiss={dismiss} headingRef={heading} />
            <WizardProgress step={step} groups={groups} />
            <div className="wiz__body">
              {error !== null ? <Alert>{error}</Alert> : null}
              <WizardStep group={groups[step]} first={step === 0} chosen={chosen} onToggle={toggle} />
            </div>
            <WizardFooter
              summary={summary} first={step === 0} last={step === total - 1} busy={busy}
              onBack={() => setStep((s) => s - 1)}
              onNext={() => setStep((s) => s + 1)}
              onFinish={() => void finish([...chosen])}
            />
          </>
        )}
      </div>
    </div>
  )
}
