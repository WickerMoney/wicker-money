import { z } from 'zod'
import { situationList } from './situationList.js'

/** Request body for previewing or completing setup. */
export const completeBody = z.object({
  /**
   * What applies to the user. `always` is implied and cannot be declined: a
   * finished setup that created nothing at all would leave someone staring at
   * an empty dropdown with no obvious way back.
   */
  situations: situationList.default([]),
})
