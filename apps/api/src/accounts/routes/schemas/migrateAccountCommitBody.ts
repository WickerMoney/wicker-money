import { confirmCountBody } from './confirmCountBody.js'
import { migrateAccountBody } from './migrateAccountBody.js'

/** Request body for actually performing a migration: the target account plus the confirmed row count. */
export const migrateAccountCommitBody = migrateAccountBody.extend(confirmCountBody.shape)
