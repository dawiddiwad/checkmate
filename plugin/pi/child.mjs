import { lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve, sep } from 'node:path'

function canonical(path) {
	try {
		return realpathSync(path)
	} catch (error) {
		if (error.code !== 'ENOENT' || lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) return null
		const parent = dirname(path)
		if (parent === path) return null
		const resolved = canonical(parent)
		return resolved && resolve(resolved, path.slice(parent.length + 1))
	}
}

function toolPath(path, cwd) {
	let value = path.replace(/^@/, '').replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
	if (value === '~') value = homedir()
	else if (value.startsWith('~/')) value = resolve(homedir(), value.slice(2))
	else if (value.startsWith('file://')) value = fileURLToPath(value)
	return resolve(cwd, value)
}

export default function (pi) {
	let policy
	try {
		policy = JSON.parse(process.env.CHECKMATE_PI_POLICY)
	} catch {}
	if (
		!Array.isArray(policy?.deny) ||
		!policy.deny.every((rule) => typeof rule === 'string') ||
		!Array.isArray(policy.scoped) ||
		!policy.scoped.every((name) => name === 'edit' || name === 'write') ||
		(policy.scoped.length && (typeof policy.work !== 'string' || !policy.work))
	) {
		pi.on('tool_call', () => ({ block: true, reason: 'The Checkmate tool policy is missing or invalid.' }))
		return
	}
	pi.registerCommand('checkmate-child-ready', { handler: async () => {} })
	const files = policy.deny.flatMap((rule) => {
		const match = /^Read\(\.\/(.*?)(\/\*\*|\*)\)$/.exec(rule)
		return match ? [{ path: match[1], prefix: match[2] === '*' }] : []
	})
	const commands = policy.deny.flatMap((rule) => {
		const match = /^Bash\((.*):\*\)$/.exec(rule)
		return match ? [match[1]] : []
	})
	const block = { block: true, reason: 'This operation is outside the work of this Checkmate session.' }
	pi.on('tool_call', (event, ctx) => {
		const scoped = policy.scoped.includes(event.toolName)
		if (scoped && typeof event.input.path !== 'string') return block
		if (
			['read', 'edit', 'write', 'grep', 'find', 'ls'].includes(event.toolName) &&
			typeof event.input.path === 'string'
		) {
			let path
			let actual
			try {
				path = toolPath(event.input.path, ctx.cwd)
				actual = canonical(path)
			} catch {
				return block
			}
			if (!actual) return block
			if (scoped) {
				const work = resolve(ctx.cwd, policy.work)
				const root = canonical(ctx.cwd)
				if (!root || !path.startsWith(work + sep)) return block
				const expected = resolve(root, relative(ctx.cwd, work))
				if (!actual.startsWith(expected + sep)) return block
			}
			if (
				files.some((rule) => {
					const restricted = resolve(ctx.cwd, rule.path)
					const target = canonical(restricted) ?? restricted
					return [
						[path, restricted],
						[actual, target],
					].some(([file, base]) =>
						rule.prefix ? file.startsWith(base) : file === base || file.startsWith(base + sep)
					)
				})
			)
				return block
		}
		if (event.toolName === 'bash' && typeof event.input.command === 'string') {
			const parts = event.input.command.split(/[;|&\n]/)
			if (
				parts.some((part) => {
					const command = part.trim().replace(/[ \t]+/g, ' ')
					return commands.some((prefix) => command.startsWith(prefix))
				})
			)
				return block
		}
	})
}
