import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AtomicWriteError, writeAtomicFile, type AtomicFileHandle } from '../../evidence/atomic-file.js'
import { temporaryRoot } from './helpers.js'

describe('atomic file writes', () => {
	it('writes restrictive files and leaves no temporary file behind', async () => {
		const temporary = await temporaryRoot()
		try {
			const path = resolve(temporary.root, 'result.json')
			await writeAtomicFile(path, 'complete\n')

			expect(await readFile(path, 'utf8')).toBe('complete\n')
			expect((await stat(path)).mode & 0o777).toBe(0o600)
			expect(await readdir(temporary.root)).toEqual(['result.json'])
		} finally {
			await temporary.cleanup()
		}
	})

	it.each(['write', 'flush', 'rename'] as const)('preserves the old file when %s fails', async (stage) => {
		const temporary = await temporaryRoot()
		try {
			const path = resolve(temporary.root, 'checkpoint.json')
			await writeFile(path, 'old')
			const operations =
				stage === 'rename' ? { rename: vi.fn(async () => fail('EIO', 'rename')) } : faultingFile(stage)

			await expect(writeAtomicFile(path, 'new', { operations })).rejects.toThrow(`${stage} failed`)
			expect(await readFile(path, 'utf8')).toBe('old')
			expect((await readdir(temporary.root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
		} finally {
			await temporary.cleanup()
		}
	})

	it('reports ordinary directory sync failures after an atomic rename', async () => {
		const temporary = await temporaryRoot()
		try {
			const path = resolve(temporary.root, 'result.json')
			const write = writeAtomicFile(path, 'new', {
				operations: {
					openDirectory: async () => ({ sync: async () => fail('EIO'), close: async () => undefined }),
				},
			})
			await expect(write).rejects.toMatchObject({
				name: 'AtomicWriteError',
				stage: 'directory-sync',
				durability: 'uncertain',
			})
			expect(await readFile(path, 'utf8')).toBe('new')
		} finally {
			await temporary.cleanup()
		}
	})

	it('classifies failures before rename as not committed', async () => {
		const temporary = await temporaryRoot()
		try {
			const path = resolve(temporary.root, 'result.json')
			let failure: unknown
			try {
				await writeAtomicFile(path, 'new', { operations: { rename: async () => fail('EIO', 'rename') } })
			} catch (error) {
				failure = error
			}
			expect(failure).toBeInstanceOf(AtomicWriteError)
			expect(failure).toMatchObject({ stage: 'rename', durability: 'not-committed' })
		} finally {
			await temporary.cleanup()
		}
	})

	it.each(['EINVAL', 'ENOTSUP'])('accepts unsupported directory sync error %s', async (code) => {
		const temporary = await temporaryRoot()
		try {
			const path = resolve(temporary.root, 'result.json')
			await writeAtomicFile(path, 'new', {
				operations: {
					openDirectory: async () => ({ sync: async () => unsupported(code), close: async () => undefined }),
				},
			})
			expect(await readFile(path, 'utf8')).toBe('new')
		} finally {
			await temporary.cleanup()
		}
	})
})

function faultingFile(stage: 'write' | 'flush'): { openFile: () => Promise<AtomicFileHandle> } {
	return {
		openFile: async (path?: string) => {
			const handle = await open(path!, 'wx', 0o600)
			return {
				writeFile: stage === 'write' ? async () => fail('EIO', 'write') : handle.writeFile.bind(handle),
				sync: stage === 'flush' ? async () => fail('EIO', 'flush') : handle.sync.bind(handle),
				close: handle.close.bind(handle),
			}
		},
	}
}

function fail(code: string, stage = 'directory'): never {
	const error = new Error(`${stage} failed`) as NodeJS.ErrnoException
	error.code = code
	throw error
}

function unsupported(code: string): never {
	const error = new Error('unsupported') as NodeJS.ErrnoException
	error.code = code
	throw error
}
