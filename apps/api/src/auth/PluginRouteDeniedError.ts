import { AppError } from '../errors.js'

/** Raised when a plugin token is used on a route it may not reach: responds `403` with code `plugin_route_denied`. */
export class PluginRouteDeniedError extends AppError {
  /** @param message - Client-safe explanation of what was refused. */
  constructor(message = 'This route is not available to plugins.') {
    super(message, 403, 'plugin_route_denied')
  }
}
