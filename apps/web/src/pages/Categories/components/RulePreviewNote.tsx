import type { RulePreview } from '../../../models/index.js'

/** Props for {@link RulePreviewNote}. */
export interface RulePreviewNoteProps {
  /** The dry-run result to describe. */
  readonly preview: RulePreview
  /** Whether the rule would also be applied to transactions already recorded. */
  readonly applyToExisting: boolean
}

/** States how many transactions a rule would touch, before it touches any. */
export function RulePreviewNote({ preview, applyToExisting }: RulePreviewNoteProps) {
  return (
    <div className="preview">
      <strong>{preview.wouldCategorize}</strong> uncategorized transaction
      {preview.wouldCategorize === 1 ? '' : 's'} would be filed here
      {applyToExisting && preview.wouldRecategorize > 0 ? (
        <>
          , and <strong>{preview.wouldRecategorize}</strong> already categorized by an
          earlier rule would move
        </>
      ) : null}
      . Categories you set by hand are never counted — they are out of scope entirely.
    </div>
  )
}
