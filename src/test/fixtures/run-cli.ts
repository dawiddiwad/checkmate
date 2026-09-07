import { runCli } from '../../cli/main.js'

const code = await runCli(process.argv.slice(2))
process.exitCode = code
