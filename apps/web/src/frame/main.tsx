import '@wickermoney/ui-kit'
import './frame.css'
import { mountPlugin } from './mountPlugin.js'

const root = document.getElementById('root')
if (root === null) throw new Error('Root element #root not found.')
void mountPlugin(root, location.hash, location.href)
