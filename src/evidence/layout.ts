import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { syncDirectoryWhenSupported } from './atomic-file.js'

const DIRECTORY_MODE = 0o700
const ID_ATTEMPTS = 100

export type RunIdentity = Readonly<{
	runId: string
	startedAt: string
	runDirectory: string
	relativeRunDirectory: string
}>

export type AllocateRunIdentityOptions = Readonly<{
	invocationRoot: string
	outputDirectory: string
	scenarioId: string
	now?: () => Date
	random?: () => Uint8Array
	directoryOperations?: Partial<DirectoryOperations>
}>

export type DirectoryOperations = Readonly<{
	mkdir(path: string, options: { mode: number }): Promise<void>
	syncDirectory(path: string): Promise<void>
}>

const defaultDirectoryOperations: DirectoryOperations = {
	mkdir: (path, options) => mkdir(path, options),
	syncDirectory: syncDirectoryWhenSupported,
}

export async function allocateRunIdentity({
	invocationRoot,
	outputDirectory,
	scenarioId,
	now = () => new Date(),
	random = () => randomBytes(8),
	directoryOperations,
}: AllocateRunIdentityOptions): Promise<RunIdentity> {
	const root = resolve(invocationRoot)
	const output = resolve(outputDirectory)
	const operations = { ...defaultDirectoryOperations, ...directoryOperations }
	assertContained(root, output)
	await ensurePrivateDirectory(root, output, operations)
	const startedAt = now().toISOString()
	const prefix = `${utcPathTime(startedAt)}-${safeSlug(scenarioId)}`

	for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
		const runId = Buffer.from(random()).toString('hex')
		if (!/^[0-9a-f]{16}$/.test(runId)) {
			throw new Error('Run identity source must return exactly eight bytes')
		}
		const runDirectory = resolveInside(output, `${prefix}-${runId}`)
		try {
			await operations.mkdir(runDirectory, { mode: DIRECTORY_MODE })
		} catch (error) {
			if (isErrorCode(error, 'EEXIST')) continue
			throw error
		}
		await operations.syncDirectory(output)
		return {
			runId,
			startedAt,
			runDirectory,
			relativeRunDirectory: toInvocationRelative(root, runDirectory),
		}
	}

	throw new Error('Unable to allocate a unique run directory')
}

export async function ensurePrivateDirectory(
	root: string,
	path: string,
	directoryOperations: Partial<DirectoryOperations> = {}
): Promise<void> {
	const resolvedRoot = resolve(root)
	const target = resolve(path)
	const operations = { ...defaultDirectoryOperations, ...directoryOperations }
	assertContained(resolvedRoot, target)
	const members = relative(resolvedRoot, target).split(sep).filter(Boolean)
	let parent = resolvedRoot

	for (const member of members) {
		const child = resolveInside(parent, member)
		try {
			await operations.mkdir(child, { mode: DIRECTORY_MODE })
		} catch (error) {
			if (!isErrorCode(error, 'EEXIST')) throw error
		}
		await operations.syncDirectory(parent)
		parent = child
	}
}

export function resolveInside(root: string, ...segments: string[]): string {
	for (const segment of segments) assertSafeSegment(segment)
	const resolvedRoot = resolve(root)
	const path = resolve(resolvedRoot, ...segments)
	assertContained(resolvedRoot, path)
	return path
}

export function toInvocationRelative(invocationRoot: string, path: string): string {
	const root = resolve(invocationRoot)
	const target = resolve(path)
	assertContained(root, target)
	const reference = relative(root, target)
	if (!reference) throw new Error('A file reference cannot point at the invocation root')
	return reference.split(sep).join('/')
}

export function safeSlug(value: string): string {
	const slug = value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)
		.replace(/-+$/g, '')
	return slug || 'item'
}

export function stepDirectoryName(ordinal: number, stepId: string): string {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('Step ordinal must be a positive integer')
	return `${String(ordinal).padStart(3, '0')}-${safeSlug(stepId)}`
}

export function harnessEvidencePath(
	identity: RunIdentity,
	ordinal: number,
	stepId: string,
	kind: 'transcript' | 'turn-snapshot',
	turn?: number
): string {
	const directory = resolveInside(
		identity.runDirectory,
		'evidence',
		'harness',
		'steps',
		stepDirectoryName(ordinal, stepId)
	)
	if (kind === 'transcript') {
		if (turn !== undefined) throw new Error('A transcript has no turn number')
		return resolveInside(directory, 'transcript.md')
	}
	if (!Number.isSafeInteger(turn) || turn! < 1) throw new Error('A turn snapshot requires a positive turn number')
	return resolveInside(directory, 'turns', `${String(turn).padStart(3, '0')}.yml`)
}

export function driverEvidenceDirectory(
	identity: RunIdentity,
	driverId: string,
	ordinal?: number,
	stepId?: string
): string {
	const directory = resolveInside(identity.runDirectory, 'evidence', 'driver', safeSlug(driverId))
	if (ordinal === undefined && stepId === undefined) return directory
	if (ordinal === undefined || stepId === undefined)
		throw new Error('Driver step evidence needs an ordinal and step ID')
	return resolveInside(directory, 'steps', stepDirectoryName(ordinal, stepId))
}

export function evidenceExtension(mediaType: string): string {
	switch (mediaType) {
		case 'application/json':
			return 'json'
		case 'application/yaml':
			return 'yml'
		case 'image/jpeg':
			return 'jpg'
		case 'image/png':
			return 'png'
		case 'text/markdown':
			return 'md'
		case 'text/plain':
			return 'txt'
		default:
			return 'bin'
	}
}

function assertSafeSegment(segment: string): void {
	if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
		throw new Error(`Unsafe evidence path segment '${segment}'`)
	}
	if (segment.includes('\0') || isAbsolute(segment)) throw new Error(`Unsafe evidence path segment '${segment}'`)
}

function assertContained(root: string, path: string): void {
	const candidate = relative(root, path)
	if (candidate === '..' || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) {
		throw new Error(`Path '${path}' escapes '${root}'`)
	}
}

function utcPathTime(iso: string): string {
	return iso.replaceAll(/[-:.]/g, '')
}

function isErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && 'code' in error && error.code === code
}
