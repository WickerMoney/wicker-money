/**
 * @module
 * Lists the routes a Fastify app registered, for tests that must cover every
 * route (authentication, plugin access).
 */

/** One registered route: an HTTP method and its full URL pattern. */
export interface RouteKey {
  readonly method: string
  readonly path: string
}

/**
 * Reads the route tree Fastify prints and flattens it into method + full path.
 *
 * Each printed line is `<tree drawing><segment> (<METHODS>)`; the drawing's
 * width (four characters per level) gives the nesting, and a segment extends
 * its parent's path. `HEAD` is Fastify's automatic twin of every `GET`, so it
 * is dropped here and asserted separately.
 */
export function enumerateRoutes(tree: string): RouteKey[] {
  const routes: RouteKey[] = []
  const parents: string[] = []
  for (const line of tree.split('\n')) {
    if (line.trim() === '') continue
    const match = /^((?:│ {3}| {4})*)(?:├── |└── )(\S+) \(([A-Z, ]+)\)$/.exec(line)
    if (match === null) throw new Error(`Unparseable route line: ${JSON.stringify(line)}`)
    const depth = (match[1] as string).length / 4
    const path = (parents[depth - 1] ?? '') + (match[2] as string)
    parents[depth] = path
    for (const method of (match[3] as string).split(', ')) {
      if (method !== 'HEAD') routes.push({ method, path })
    }
  }
  return routes
}
