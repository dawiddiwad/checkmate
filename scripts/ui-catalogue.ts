import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startUi } from '../plugin/src/ui/server.ts'

// Starts the review UI with the component catalogue at /catalogue. `checkmate ui` never serves it.
const workspace = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'checkmate-catalogue-'))
const ui = await startUi({ workspace, catalogue: true })
console.log(new URL('/catalogue', ui.url).href)
