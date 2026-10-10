/**
 * Transaction-local database setting through which the API tells
 * `core.register_user` which email may become the instance owner. Migration
 * 028 reads the same name.
 */
export const BOOTSTRAP_OWNER_SETTING = 'app.bootstrap_owner_email'
