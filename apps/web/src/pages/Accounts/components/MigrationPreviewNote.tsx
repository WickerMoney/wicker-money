import type { MigrationPlan } from '../../../models/index.js'

/** Props for {@link MigrationPreviewNote}. */
export interface MigrationPreviewNoteProps {
  /** The preview to describe. */
  readonly plan: MigrationPlan
}

/** States what moving an account's history would move, and what it would remove instead. */
export function MigrationPreviewNote({ plan }: MigrationPreviewNoteProps) {
  return (
    <div className="preview">
      Would move <strong>{plan.movedTransactions}</strong> transaction
      {plan.movedTransactions === 1 ? '' : 's'} and{' '}
      <strong>{plan.movedRecurringItems}</strong> recurring item
      {plan.movedRecurringItems === 1 ? '' : 's'}.
      {plan.removedTransferTransactions > 0 || plan.removedTransferRecurringItems > 0 ? (
        <>
          {' '}Transfers recorded between these two accounts become internal once merged, so{' '}
          <strong>{plan.removedTransferTransactions}</strong> transaction
          {plan.removedTransferTransactions === 1 ? '' : 's'} and{' '}
          <strong>{plan.removedTransferRecurringItems}</strong> recurring item
          {plan.removedTransferRecurringItems === 1 ? '' : 's'} of that kind will be
          removed rather than moved.
        </>
      ) : null}
    </div>
  )
}
