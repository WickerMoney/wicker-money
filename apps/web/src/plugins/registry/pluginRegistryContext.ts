import { createContext } from 'react'
import type { PluginRegistryState } from './PluginRegistryState.js'

/** Context carrying the loaded plugin registry; `null` until a provider loads it. */
export const PluginRegistryCtx = createContext<PluginRegistryState | null>(null)
