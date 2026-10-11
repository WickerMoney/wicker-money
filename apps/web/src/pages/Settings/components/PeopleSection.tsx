import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Alert, Spinner, Surface, formErrorsFrom } from '@wickermoney/ui-kit'
import { useAuth } from '../../../auth/index.js'
import { ApiError } from '../../../api/ApiError.js'
import type { Person } from '../../../models/index.js'
import { setPersonRole } from '../../../people/peopleApi.js'
import { usePeople } from '../../../people/usePeople.js'
import { ConfirmDemotionDialog } from './ConfirmDemotionDialog.js'
import { PersonRow } from './PersonRow.js'

/** The element id the section is reached by, as in `/settings#people`. */
const ANCHOR = 'people'

/** Shown on the role field when the list says the owner is the only one, before asking the server. */
const ONLY_OWNER = 'You are the only owner. Make another account an owner first, then you can step down.'

type Role = 'owner' | 'member'

const roleWord = (role: Role): string => (role === 'owner' ? 'an owner' : 'a member')

/**
 * People: every account on this instance and, for an owner, a role select for
 * each. Owners only; a member sees nothing of it, and the owner-only listing
 * is never requested for them.
 *
 * Making someone an owner applies at once and says so. Making an owner a
 * member asks first, because it is the direction that takes something away.
 * The select shows the saved role until the server has answered, and a refusal
 * is shown on that account's own role field: the last owner cannot be
 * demoted, which the server enforces whatever this page thinks it knows.
 *
 * An owner may step down while another owner remains. When they do, the page
 * re-reads who they are so the rest of Settings stops offering owner controls
 * at once, and this section is replaced by a short notice that takes focus,
 * since the control they were using is gone. The same happens if the server
 * reports that they are no longer an owner at all (another owner demoted them
 * while this page was open).
 *
 * Which view to show comes from the signed-in user's role; the server checks
 * the role again on every request, so hiding the section is a courtesy, not
 * the protection.
 */
export function PeopleSection() {
  const { user, refreshUser } = useAuth()
  const isOwner = user?.role === 'owner'
  const state = usePeople(isOwner)
  const location = useLocation()
  /** The latest known state of each account this page has changed, over the listing. */
  const [changed, setChanged] = useState<Readonly<Record<string, Person>>>({})
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [confirming, setConfirming] = useState<Person | null>(null)
  /** What was announced after the last change, for the live region. */
  const [announcement, setAnnouncement] = useState('')
  /** Set once this owner stopped being one while the page was open; replaces the section with a notice. */
  const [lostAccess, setLostAccess] = useState<string | null>(null)
  const notice = useRef<HTMLParagraphElement>(null)

  const ready = state.kind !== 'loading'
  useEffect(() => {
    if (ready && location.hash === `#${ANCHOR}`) document.getElementById(ANCHOR)?.scrollIntoView?.({ block: 'start' })
  }, [ready, location.hash])

  // The control the owner was using is gone, so move to the explanation of why.
  useEffect(() => {
    if (lostAccess !== null) notice.current?.focus()
  }, [lostAccess])

  const fail = (id: string, e: unknown): void => {
    if (e instanceof ApiError && e.code === 'owner_required') {
      // Demoted from elsewhere. Re-read who we are so the whole page agrees.
      setLostAccess('You are no longer an owner of this instance, so you can no longer change roles.')
      void refreshUser().catch(() => { /* The notice already says it; the next page load will agree. */ })
      return
    }
    const messages = formErrorsFrom(e, ['role'], 'Could not change the role.')
    setErrors((all) => ({ ...all, [id]: messages.fields['role'] ?? messages.form ?? 'Could not change the role.' }))
  }

  /** Saves a role. Resolves once the row has settled, so a dialog can stay open until then. */
  const apply = async (person: Person, role: Role): Promise<void> => {
    const id = person.id
    setSaving((s) => new Set(s).add(id))
    setErrors(({ [id]: _dropped, ...rest }) => rest)
    setAnnouncement('')
    try {
      const result = await setPersonRole(id, role)
      setChanged((c) => ({ ...c, [id]: result.user }))
      setAnnouncement(
        result.changed
          ? `${person.email} is now ${roleWord(result.user.role)}.`
          : `${person.email} was already ${roleWord(result.user.role)}.`,
      )
      if (id === user?.id && result.user.role !== 'owner') {
        // Say so first: the notice replaces the section whether or not the re-read succeeds.
        setLostAccess('You are now a member. You can no longer turn plugins on or off or change anyone\u2019s role; another owner can give that back.')
        await refreshUser().catch(() => { /* The notice already says it; the next page load will agree. */ })
      }
    } catch (e) {
      fail(id, e)
    } finally {
      setSaving((s) => { const copy = new Set(s); copy.delete(id); return copy })
    }
  }

  if (lostAccess !== null) {
    return (
      <div id={ANCHOR} className="settings-anchor">
        <Surface title="People">
          <p role="status" tabIndex={-1} ref={notice} className="people-notice">{lostAccess}</p>
        </Surface>
      </div>
    )
  }
  if (!isOwner) return null

  let body: React.ReactNode
  if (state.kind === 'loading') {
    body = <Spinner label="Loading people" />
  } else if (state.kind === 'error') {
    body = <Alert>{state.message}</Alert>
  } else if (state.kind === 'loaded') {
    const people = state.people.map((p) => changed[p.id] ?? p)
    const owners = people.filter((p) => p.role === 'owner').length

    const choose = (person: Person, role: Role): void => {
      if (role === person.role || saving.has(person.id)) return
      if (role === 'owner') { void apply(person, role); return }
      if (person.id === user?.id && owners <= 1) {
        // The server would refuse; say so without the round trip.
        setErrors((all) => ({ ...all, [person.id]: ONLY_OWNER }))
        return
      }
      setErrors(({ [person.id]: _dropped, ...rest }) => rest)
      setConfirming(person)
    }

    body = (
      <>
        <p className="form-hint people-intro">
          Owners can turn plugins on or off and change anyone&rsquo;s role. Members use everything else.
          Making someone an owner gives them the same control you have. An instance always keeps at
          least one owner.
        </p>
        <ul className="people-list">
          {people.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              isSelf={p.id === user?.id}
              saving={saving.has(p.id)}
              error={errors[p.id] ?? null}
              onChange={(role) => { choose(p, role) }}
            />
          ))}
        </ul>
        {confirming !== null ? (
          <ConfirmDemotionDialog
            person={confirming}
            isSelf={confirming.id === user?.id}
            busy={saving.has(confirming.id)}
            onCancel={() => { setConfirming(null) }}
            onConfirm={() => { void apply(confirming, 'member').then(() => { setConfirming(null) }) }}
          />
        ) : null}
      </>
    )
  }

  const count = state.kind === 'loaded' ? state.people.length : null
  return (
    <div id={ANCHOR} className="settings-anchor">
      <Surface title="People" action={count === null ? null : <span className="wm-muted">{count} {count === 1 ? 'account' : 'accounts'}</span>}>
        {body}
        <p className="wm-muted people-announcement" role="status">{announcement}</p>
      </Surface>
    </div>
  )
}
