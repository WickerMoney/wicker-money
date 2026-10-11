/**
 * The phrases a person types to confirm each erase, compared without regard to
 * case or surrounding spaces. The two differ so that one cannot be typed for the
 * other, and the web app shows the phrase it expects; the server checks it too,
 * so a script cannot erase by leaving the field out.
 */
export const ERASE_PHRASES = {
  /** Erasing the calling user's own data. */
  myData: 'erase my data',
  /** Erasing every account and every plugin schema on the instance. */
  instance: 'erase this instance',
} as const
