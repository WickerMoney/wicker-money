// tsc does not emit non-TS assets. Copy the stylesheets alongside the compiled
// output so `import '@wickermoney/ui-kit'` resolves its CSS from dist.
import { copyFile, mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
for (const file of ['tokens.css', 'components.css']) {
  await copyFile(`src/${file}`, `dist/${file}`)
}
