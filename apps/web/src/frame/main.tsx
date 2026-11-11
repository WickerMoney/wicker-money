// No zod here, and no import of the SDK root (`@wickermoney/plugin-sdk`): both are about 85 kB a frame would
// download and parse for nothing. The one place the frame needs them (checking an integrity pin, which only a
// plugin the host did not ship has) loads them on demand and configures zod first: see `fragment.ts`.
import '@wickermoney/ui-kit'
import './frame.css'
import { mountPlugin } from './mountPlugin.js'

const root = document.getElementById('root')
if (root === null) throw new Error('Root element #root not found.')
void mountPlugin(root, location.hash, location.href)
