/**
 * What a person types to confirm each erase. The server checks the same words
 * (`ERASE_PHRASES` in the API's settings service) and is the authority; these
 * only keep the button off until the words are right.
 */
export const ERASE_PHRASES = {
  myData: 'erase my data',
  instance: 'erase this instance',
} as const
