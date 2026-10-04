import { useMemo, useState } from 'react'
import { Button, FormError, Surface } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useOnboarding } from '../../../onboarding/useOnboarding.js'

/** Props for {@link StarterCategoriesPanel}. */
export interface StarterCategoriesPanelProps {
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after setup is reset so the category list can be re-read. */
  readonly onChanged: () => Promise<void>
}

/**
 * Explains what the setup wizard did for this account and lets the user re-run
 * or reset it.
 *
 * The destructive half of a reset is opt-in and limited on the server to
 * catalog categories that nothing references; anything with a transaction, split
 * or rule pointing at it is kept and named in the result message.
 */
export function StarterCategoriesPanel({ status, onChanged }: StarterCategoriesPanelProps) {
  const { status: onboarding, start, refresh: refreshOnboarding } = useOnboarding()
  const [removeOnReset, setRemoveOnReset] = useState(false)
  // Shown beside the buttons, not in the page's banner, which is far above
  // them once the category list is long.
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * What the wizard was told, in the words it used to ask.
   *
   * The stored answers are slugs; the labels come from the same server payload
   * the wizard renders, so there is no second copy to keep in step.
   */
  const answered = useMemo(() => {
    if (onboarding === null) return []
    const labels = new Map(
      onboarding.groups.flatMap((g) => g.questions.map((q) => [q.situation, q.label] as const)),
    )
    return onboarding.situations.filter((s) => s !== 'always').map((s) => labels.get(s) ?? s)
  }, [onboarding])

  const resetSetup = async () => {
    setFailure(null)
    status.begin()
    try {
      const r = await api.post<{ removed: number; kept: string[] }>('/onboarding/reset', {
        removeCategories: removeOnReset,
      })
      await onChanged()
      await refreshOnboarding()
      status.show(
        r.removed === 0
          ? 'Setup reset. Your categories were left alone.'
          : `Setup reset and ${r.removed} unused categories removed.` +
            (r.kept.length > 0
              ? ` ${r.kept.length} kept because transactions or rules use them: ${r.kept.slice(0, 5).join(', ')}${r.kept.length > 5 ? '…' : ''}.`
              : ''),
      )
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not reset setup.')
    } finally { status.end() }
  }

  return (
    <Surface title="Starter categories">
      <p className="form-hint">
        A ready-made set, carried over from the taxonomy the previous version used. Setup asks
        which circumstances apply to you and creates only the branches that go with them —
        nothing you already have is touched.
      </p>

      {/* Three distinguishable states, not two: an account that was marked as
          set up without ever answering the wizard has no stored answers, which
          is not the same as an account that answered "no" to everything. */}
      {onboarding !== null && onboarding.onboardedAt === null ? (
        <p className="form-hint">Setup has not been run on this account yet.</p>
      ) : answered.length > 0 ? (
        <p className="form-hint">Based on: {answered.join(' · ')}.</p>
      ) : onboarding !== null && onboarding.situations.length === 0 ? (
        <p className="form-hint">
          Your categories predate setup. Running it adds anything missing and leaves the rest
          alone.
        </p>
      ) : (
        <p className="form-hint">Set up with the basics only.</p>
      )}

      <div className="page__actions">
        <Button variant="primary" disabled={status.busy} onClick={start}>
          {onboarding !== null && onboarding.onboardedAt === null ? 'Run setup' : 'Run setup again'}
        </Button>
        <Button disabled={status.busy} onClick={() => void resetSetup()}>
          {status.busy ? 'Working…' : 'Reset setup'}
        </Button>
      </div>
      <FormError message={failure} />

      <label className="check">
        <input
          type="checkbox"
          checked={removeOnReset}
          onChange={(e) => setRemoveOnReset(e.target.checked)}
        />
        <span>
          On reset, also delete the starter categories. Only ones from the catalog that no
          transaction, split or rule points at — anything in use is kept.
        </span>
      </label>
    </Surface>
  )
}
