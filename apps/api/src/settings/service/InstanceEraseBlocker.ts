/**
 * Why an instance cannot be erased right now, or `null` when nothing stands in
 * the way. Each is a configuration problem the operator fixes first, because
 * erasing would leave an instance nobody can set up again.
 *
 *  - `registration_disabled`: `REGISTRATION_ENABLED=false`, so after the erase
 *    no one could register the first owner.
 *  - `bootstrap_owner_mismatch`: `BOOTSTRAP_OWNER_EMAIL` names a different
 *    address from the owner who is erasing, so after the erase that owner could
 *    not become an owner again, and a registration with the configured address
 *    would be needed to administer the instance.
 */
export type InstanceEraseBlocker = 'registration_disabled' | 'bootstrap_owner_mismatch' | null
