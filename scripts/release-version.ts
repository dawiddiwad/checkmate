import { execFileSync } from 'node:child_process'
import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { requireCondition } from '../src/files.ts'

function parts(version: string): number[] {
	requireCondition(/^\d+\.\d+\.\d+$/.test(version), 'Use a stable three-part release version')
	return version.split('.').map(Number)
}

export function releaseVersion(current: string, tags: string[]): string {
	const version = parts(current)
	const published = tags.filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
	for (const tag of published) {
		const candidate = parts(tag.slice(1))
		const difference = candidate.map((part, i) => part - version[i]).find((value) => value !== 0) ?? 0
		requireCondition(difference <= 0, 'Repository version is behind an existing release tag')
	}
	return published.includes(`v${current}`) ? `${version[0]}.${version[1]}.${version[2] + 1}` : current
}

export async function prepareVersion(directory: string): Promise<string> {
	const read = async (path: string) => JSON.parse(await readFile(resolve(directory, path), 'utf8'))
	const packageJson = await read('package.json')
	const lock = await read('package-lock.json')
	const plugin = await read('.claude-plugin/plugin.json')
	const marketplace = await read('.claude-plugin/marketplace.json')
	const entry = marketplace.plugins.find((item: { name: string }) => item.name === 'checkmate')
	requireCondition(packageJson.private === true, 'The project must remain private on npm')
	requireCondition(
		entry &&
			[lock.version, lock.packages[''].version, plugin.version, entry.version].every(
				(version) => version === packageJson.version
			),
		'Version files are inconsistent'
	)
	const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: directory, encoding: 'utf8' }).trim().split('\n')
	const version = releaseVersion(packageJson.version, tags)
	packageJson.version = lock.version = lock.packages[''].version = plugin.version = entry.version = version
	for (const [path, value] of [
		['package.json', packageJson],
		['package-lock.json', lock],
		['.claude-plugin/plugin.json', plugin],
		['.claude-plugin/marketplace.json', marketplace],
	] as const) {
		await writeFile(resolve(directory, path), JSON.stringify(value, null, '\t') + '\n')
	}
	return version
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const version = await prepareVersion(process.cwd())
	if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`)
	else console.log(version)
}
