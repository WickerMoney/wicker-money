/** Props for {@link Stat}. */
export interface StatProps {
  /** Caption shown with the figure. */
  readonly label: string
  /** The figure, already formatted for display. */
  readonly value: string
  /** Colours the value. `'auto'` derives it from a leading minus sign. Defaults to `'neutral'`. */
  readonly tone?: 'neutral' | 'positive' | 'negative' | 'auto'
}

/** A labelled figure, such as a balance or a total. */
export function Stat({ label, value, tone = 'neutral' }: StatProps) {
  const resolved = tone === 'auto' ? (value.trimStart().startsWith('-') ? 'negative' : 'positive') : tone
  const cls = resolved === 'positive' ? 'wm-pos' : resolved === 'negative' ? 'wm-neg' : undefined
  return (
    <div>
      <div className="wm-stat__label">{label}</div>
      <div className={['wm-stat__value', cls].filter(Boolean).join(' ')}>{value}</div>
    </div>
  )
}
