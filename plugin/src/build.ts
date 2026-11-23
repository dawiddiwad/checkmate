import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { executableOnPath } from './sessions.ts'

const instructionFolders = ['agents', 'contracts', 'references', 'skills']

function pluginRootOf(bundle: string) {
	const moduleRoot = dirname(dirname(bundle))
	return existsSync(join(moduleRoot, '.claude-plugin', 'plugin.json')) ? moduleRoot : join(moduleRoot, 'plugin')
}

function filesUnder(folder: string): string[] {
	if (!existsSync(folder)) return []
	return readdirSync(folder)
		.sort()
		.flatMap((name) => {
			const path = join(folder, name)
			return statSync(path).isDirectory() ? filesUnder(path) : [path]
		})
}

export function buildDigest(bundle: string) {
	const root = pluginRootOf(bundle)
	const hash = createHash('sha256').update(readFileSync(bundle))
	for (const folder of instructionFolders) {
		for (const path of filesUnder(join(root, folder))) {
			hash.update(path.slice(root.length)).update(readFileSync(path))
		}
	}
	return hash.digest('hex').slice(0, 12)
}

export function versionLines(version: string, bundle: string, env: NodeJS.ProcessEnv) {
	const running = fileURLToPath(bundle)
	const digest = buildDigest(running)
	const lines = [`${version} build ${digest}`, `running ${running}`]
	const onPath = executableOnPath('checkmate', env)
	if (!onPath) return lines
	const resolved = realpathSync(onPath)
	const other = buildDigest(resolved)
	if (other !== digest) {
		lines.push(
			`warning: the checkmate on PATH is build ${other} at ${resolved}. This build is ${digest}. Commands run by this session use ${running}.`
		)
	}
	return lines
}
