import { readFileSync } from 'node:fs'
import { main } from '../../plugin/src/index.ts'

function version() {
	return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string
}

if (import.meta.main) {
	const argv = process.argv.slice(2)
	if (argv[0] === '--version') process.stdout.write(version() + '\n')
	else await main(argv)
}
