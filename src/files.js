import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, mkdir, open, link, unlink, stat } from 'node:fs/promises'
import { resolve, relative, dirname, isAbsolute } from 'node:path'

export function requireCondition(condition, message) {
	if (!condition) throw new Error(message)
}

export function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex')
}

export async function confined(root, name) {
	requireCondition(
		typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !name.includes('\\'),
		'Use a relative path'
	)
	const base = await realpath(root)
	const destination = resolve(base, name)
	const inside = (path) =>
		path === base || (!relative(base, path).startsWith('..') && !isAbsolute(relative(base, path)))
	requireCondition(destination !== base && inside(destination), 'Path is outside its root')
	let existing = destination
	for (;;) {
		try {
			requireCondition(inside(await realpath(existing)), 'Symlink is outside its root')
			break
		} catch (error) {
			if (error.code !== 'ENOENT') throw error
			existing = dirname(existing)
		}
	}
	return destination
}

export async function readDocument(root, name) {
	const path = await confined(root, name)
	requireCondition((await stat(path)).size <= 4 * 1024 * 1024, 'Document exceeds 4 MiB')
	const bytes = await readFile(path)
	let value
	try {
		value = JSON.parse(bytes.toString('utf8'))
	} catch {
		throw new Error('Document is not valid JSON')
	}
	return { value, reference: { path: name, sha256: digest(bytes) } }
}

export async function readReference(root, reference) {
	const document = await readDocument(root, reference.path)
	requireCondition(document.reference.sha256 === reference.sha256, 'Document digest changed')
	return document.value
}

export async function publish(root, name, value) {
	const path = await confined(root, name)
	await mkdir(dirname(path), { recursive: true })
	await confined(root, name)
	const temporary = `${path}.${randomUUID()}.tmp`
	const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'
	const file = await open(temporary, 'wx', 0o600)
	try {
		await file.writeFile(bytes)
		await file.sync()
		await file.close()
		await link(temporary, path)
		const directory = await open(dirname(path), 'r')
		try {
			await directory.sync()
		} finally {
			await directory.close()
		}
	} finally {
		await file.close()
		await unlink(temporary).catch(() => {})
	}
	return { path: name, sha256: digest(bytes) }
}

export function same(a, b) {
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]))
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		const keys = Object.keys(a).sort()
		return same(keys, Object.keys(b).sort()) && keys.every((key) => same(a[key], b[key]))
	}
	return a === b
}
