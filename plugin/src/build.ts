import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { executableOnPath } from './sessions.ts'
import { hostSession } from './actor.ts'

const instructionFolders = ['agents', 'contracts', 'pi', 'recipes', 'references', 'skills']

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
	const root = dirname(dirname(bundle))
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
	if (onPath) {
		const resolved = realpathSync(onPath)
		const other = buildDigest(resolved)
		if (other !== digest) {
			lines.push(
				hostSession(env)
					? 'warning: The Checkmate command on your system is a different build. This session uses its bundled build.'
					: `warning: the checkmate on PATH is build ${other} at ${resolved}. This build is ${digest}. Commands run by this session use ${running}.`
			)
		}
	}
	return [...lines, ...piCopyWarnings(bundle, env, process.cwd())]
}

type PiDeclaration = { scope: 'global' | 'project'; source: string }

function piDeclarations(env: NodeJS.ProcessEnv, cwd: string): PiDeclaration[] {
	const agentDirectory = env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent')
	const files: Array<[PiDeclaration['scope'], string]> = [
		['global', join(agentDirectory, 'settings.json')],
		['project', join(cwd, '.pi', 'settings.json')],
	]
	return files.flatMap(([scope, file]) => {
		if (!existsSync(file)) return []
		let packages: unknown
		try {
			packages = (JSON.parse(readFileSync(file, 'utf8')) as { packages?: unknown }).packages
		} catch {
			return []
		}
		if (!Array.isArray(packages)) return []
		return packages
			.map((entry) => (typeof entry === 'string' ? entry : (entry as { source?: unknown })?.source))
			.filter((source): source is string => typeof source === 'string' && /checkmate/i.test(source))
			.map((source) => ({ scope, source }))
	})
}

function packageRootOf(file: string) {
	let folder = dirname(file)
	while (!existsSync(join(folder, 'package.json')) && dirname(folder) !== folder) folder = dirname(folder)
	return folder
}

export function piCopyWarnings(bundle: string, env: NodeJS.ProcessEnv, cwd: string) {
	const root = packageRootOf(fileURLToPath(bundle))
	return piDeclarations(env, cwd)
		.filter(({ source }) => !(isAbsolute(source) && (resolve(source) + sep).startsWith(root + sep)))
		.map(({ scope, source }) =>
			hostSession(env)
				? `warning: Pi declares another Checkmate package at ${scope} scope. Choose which installation to keep in Pi.`
				: `warning: Pi declares another Checkmate package at ${scope} scope: ${source}. This build runs from ${root}. Remove it with: pi remove ${source}${scope === 'project' ? ' -l' : ''}. A project package loads only after Pi approves the folder: start Pi with --approve, or approve the folder when Pi asks.`
		)
}
