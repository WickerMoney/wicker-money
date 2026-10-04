import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Alert, EmptyState, Spinner, Surface } from '@wickermoney/ui-kit'
import { useAuth } from '../../../auth/index.js'
import type { RegisteredPlugin } from '../../../models/index.js'
import { setPluginEnabled } from '../../../plugins/admin/pluginAdminApi.js'
import { useRegisteredPlugins } from '../../../plugins/admin/useRegisteredPlugins.js'
import { usePluginRegistry } from '../../../plugins/registry/index.js'
import { manifestToRegistered } from '../helpers/manifestToRegistered.js'
import { PluginCard } from './PluginCard.js'

/** The element id the section is reached by, as in `/settings#plugins`. */
const ANCHOR = 'plugins'

const byName = (a: RegisteredPlugin, b: RegisteredPlugin): number => a.name.localeCompare(b.name)

/**
 * The plugin manager: every plugin on this instance and, for an owner, a
 * switch to turn each one on or off for everyone.
 *
 * A switch flips at once and is locked until the server has answered and the
 * shell has reloaded its registry, so the sidebar, routes and dashboard have
 * already caught up by the time it can be used again. If the server refuses,
 * the switch goes back and the card says why. There is no confirmation step:
 * switching a plugin off deletes nothing, so it is undone by switching it on.
 *
 * A member sees the plugins that are on, read-only, and the owner-only
 * listing is never requested. Which view to show comes from the signed-in
 * user's role; the server checks the role again on every request, so hiding
 * the switches is a courtesy, not the protection.
 */
export function PluginsSection() {
  const isOwner = useAuth().user?.role === 'owner'
  const registered = useRegisteredPlugins(isOwner)
  const { plugins: loaded, refresh } = usePluginRegistry()
  const location = useLocation()
  /** The latest known state of each plugin this page has changed, over the listing. */
  const [changed, setChanged] = useState<Readonly<Record<string, RegisteredPlugin>>>({})
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})

  // React Router does not scroll to a fragment; the "Manage plugins" link
  // from a switched-off plugin's page lands here.
  const ready = registered.kind !== 'loading'
  useEffect(() => {
    if (ready && location.hash === `#${ANCHOR}`) document.getElementById(ANCHOR)?.scrollIntoView?.({ block: 'start' })
  }, [ready, location.hash])

  const toggle = async (current: RegisteredPlugin, next: boolean): Promise<void> => {
    const id = current.id
    setSaving((s) => new Set(s).add(id))
    setErrors(({ [id]: _dropped, ...rest }) => rest)
    setChanged((c) => ({ ...c, [id]: { ...current, enabled: next, status: next ? 'enabled' : 'disabled' } }))
    try {
      const result = await setPluginEnabled(id, next)
      setChanged((c) => ({ ...c, [id]: result.plugin }))
      // Applies the change to this tab's shell before the switch unlocks.
      await refresh()
    } catch (e) {
      setChanged((c) => ({ ...c, [id]: current }))
      setErrors((all) => ({
        ...all,
        [id]: `Could not turn ${current.name} ${next ? 'on' : 'off'}: ${e instanceof Error ? e.message : 'unknown error'}`,
      }))
    } finally {
      setSaving((s) => { const copy = new Set(s); copy.delete(id); return copy })
    }
  }

  let body: React.ReactNode
  let summary: React.ReactNode = null
  if (registered.kind === 'loading') {
    body = <Spinner label="Loading plugins" />
  } else if (registered.kind === 'error') {
    body = <Alert>{registered.message}</Alert>
  } else if (registered.kind === 'skipped') {
    const rows = loaded.map(manifestToRegistered).sort(byName)
    body = (
      <>
        <p className="form-hint plugin-list__intro">
          These plugins are on for everyone on this Wicker Money instance. Only an owner can turn plugins on or off.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No plugins are on" hint="An owner can turn plugins on in Settings." />
        ) : (
          <ul className="plugin-list">
            {rows.map((p) => <PluginCard key={p.id} plugin={p} showOrigin={false} />)}
          </ul>
        )}
      </>
    )
  } else {
    const rows = registered.plugins.map((p) => changed[p.id] ?? p).sort(byName)
    const on = rows.filter((p) => p.enabled).length
    summary = <span className="wm-muted">{on} of {rows.length} on</span>
    body = (
      <>
        <p className="form-hint plugin-list__intro">
          Turn plugins on or off for everyone on this instance. Turning one off removes its pages and
          widgets but deletes nothing it stored; turn it back on and everything is where it was.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No plugins are installed" />
        ) : (
          <ul className="plugin-list">
            {rows.map((p) => (
              <PluginCard
                key={p.id}
                plugin={p}
                showOrigin
                saving={saving.has(p.id)}
                error={errors[p.id] ?? null}
                onToggle={(next) => { void toggle(p, next) }}
              />
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <div id={ANCHOR} className="settings-anchor">
      <Surface title="Plugins" action={summary}>{body}</Surface>
    </div>
  )
}
