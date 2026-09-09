import { randomBytes } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const FILE_MODE = 0o600
const TEMP_ATTEMPTS = 10

export type AtomicWriteStage = 'temporary-open' | 'write' | 'file-sync' | 'close' | 'rename' | 'directory-sync'
export type AtomicWriteDurability = 'not-committed' | 'uncertain'

export class AtomicWriteError extends Error {
	constructor(
		readonly stage: AtomicWriteStage,
		readonly durability: AtomicWriteDurability,
		cause: unknown
	) {
		const detail = cause instanceof Error ? cause.message : String(cause)
		super(`Atomic write failed during ${stage}: ${detail}`, { cause })
		this.name = 'AtomicWriteError'
	}
}

export type AtomicFileHandle = Pick<FileHandle, 'writeFile' | 'sync' | 'close'>
export type AtomicDirectoryHandle = Pick<FileHandle, 'sync' | 'close'>

export type AtomicFileOperations = Readonly<{
	openFile(path: string, flags: 'wx', mode: number): Promise<AtomicFileHandle>
	rename(from: string, to: string): Promise<void>
	unlink(path: string): Promise<void>
	openDirectory(path: string): Promise<AtomicDirectoryHandle>
	randomSuffix(): string
}>

export type AtomicWriteOptions = Readonly<{
	operations?: Partial<AtomicFileOperations>
}>

const defaultOperations: AtomicFileOperations = {
	openFile: (path, flags, mode) => open(path, flags, mode),
	rename,
	unlink,
	openDirectory: (path) => open(path, 'r'),
	randomSuffix: () => randomBytes(8).toString('hex'),
}

export async function writeAtomicFile(
	destination: string,
	content: string | Uint8Array,
	options: AtomicWriteOptions = {}
): Promise<void> {
	const operations = { ...defaultOperations, ...options.operations }
	let temporary: { path: string; handle: AtomicFileHandle }
	try {
		temporary = await openTemporary(destination, operations)
	} catch (error) {
		throw new AtomicWriteError('temporary-open', 'not-committed', error)
	}
	let renamed = false
	let stage: AtomicWriteStage = 'write'

	try {
		await temporary.handle.writeFile(content)
		stage = 'file-sync'
		await temporary.handle.sync()
		stage = 'close'
		await temporary.handle.close()
		stage = 'rename'
		await operations.rename(temporary.path, destination)
		renamed = true
		stage = 'directory-sync'
		await syncDirectoryWhenSupported(dirname(destination), operations)
	} catch (error) {
		await closeQuietly(temporary.handle)
		if (!renamed) await unlinkQuietly(temporary.path, operations)
		throw new AtomicWriteError(stage, renamed ? 'uncertain' : 'not-committed', error)
	}
}

async function openTemporary(
	destination: string,
	operations: AtomicFileOperations
): Promise<{ path: string; handle: AtomicFileHandle }> {
	for (let attempt = 0; attempt < TEMP_ATTEMPTS; attempt++) {
		const path = join(dirname(destination), `.${basename(destination)}.${operations.randomSuffix()}.tmp`)
		try {
			return { path, handle: await operations.openFile(path, 'wx', FILE_MODE) }
		} catch (error) {
			if (!isErrorCode(error, 'EEXIST')) throw error
		}
	}
	throw new Error(`Unable to allocate a temporary file for '${basename(destination)}'`)
}

export async function syncDirectoryWhenSupported(
	path: string,
	operations: Pick<AtomicFileOperations, 'openDirectory'> = defaultOperations
): Promise<void> {
	let handle: AtomicDirectoryHandle | undefined
	try {
		handle = await operations.openDirectory(path)
		await handle.sync()
	} catch (error) {
		if (!isUnsupportedDirectorySync(error)) throw error
	} finally {
		if (handle) await handle.close()
	}
}

async function closeQuietly(handle: AtomicFileHandle): Promise<void> {
	try {
		await handle.close()
	} catch {
		// Preserve the operation that made the atomic write fail.
	}
}

async function unlinkQuietly(path: string, operations: AtomicFileOperations): Promise<void> {
	try {
		await operations.unlink(path)
	} catch {
		// Preserve the write failure; a stale private temp file is not a committed result.
	}
}

function isUnsupportedDirectorySync(error: unknown): boolean {
	return isErrorCode(error, 'EINVAL') || isErrorCode(error, 'ENOTSUP')
}

function isErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && 'code' in error && error.code === code
}
