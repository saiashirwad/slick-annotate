import { copyFileSync, globSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

copyFileSync('node_modules/mermaid/dist/mermaid.min.js', 'dist/mermaid.min.js')

// Preserve dependency notices separately from the bundled code.
rmSync('dist/licenses', { recursive: true, force: true })

for (const file of globSync('**/{LICENSE*,NOTICE*,COPYING*}', { cwd: 'node_modules' })) {
  const destination = join('dist/licenses', file)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(join('node_modules', file), destination)
}
