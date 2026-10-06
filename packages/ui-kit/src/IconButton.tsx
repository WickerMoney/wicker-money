import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** The icons an {@link IconButton} can draw. */
export type IconName = 'edit' | 'delete' | 'disable' | 'enable' | 'archive' | 'history' | 'end' | 'balance'

// Paths are 24x24, stroke-only, in the style of the Lucide set (ISC licence).
const ICONS: Record<IconName, ReactNode> = {
  edit: (
    <>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>
  ),
  delete: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  enable: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  archive: (
    <>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  end: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
      <path d="m14 14-4 4" />
      <path d="m10 14 4 4" />
    </>
  ),
  balance: (
    <>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </>
  ),
  disable: (
    <>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M2 2l20 20" />
    </>
  ),
}

/** Props for {@link IconButton}: every native `<button>` attribute except its content. */
export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' | 'aria-label'> {
  /** Which icon to draw. */
  readonly icon: IconName
  /**
   * What the button does, in words ("Edit", "Delete"). It is the button's
   * accessible name and its hover tooltip, so it is required: an icon alone
   * says nothing to a screen reader.
   */
  readonly label: string
  /** Visual emphasis. Defaults to `"default"`. */
  readonly variant?: 'default' | 'danger'
}

/**
 * A square, icon-only button for table rows.
 *
 * Uses the same `wm-btn` styling as {@link Button}, so disabled, hover and the
 * danger colour behave identically; it only swaps the text for a drawn icon and
 * pins the size so a column of them lines up.
 */
export function IconButton({ icon, label, variant = 'default', className, ...rest }: IconButtonProps) {
  const classes = ['wm-btn', 'wm-icon-btn', variant === 'danger' ? 'wm-btn--danger' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" {...rest} className={classes} aria-label={label} title={label}>
      <svg
        viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      >
        {ICONS[icon]}
      </svg>
    </button>
  )
}
