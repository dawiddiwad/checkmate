import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { uiFilePath, hookTokenPath } from '../sessions.ts'
import { isBusy } from '../store.ts'

export const lifecyclePath = '/internal/ui-lifecycle'
type LifecycleAction = 'status' | 'open-pi' | 'stop'

export function lifecycleProof(
	token: string,
	workspace: string,
	pid: number,
	action: LifecycleAction,
	nonce: string,
	body?: string
) {
	return createHmac('sha256', token)
		.update(JSON.stringify([workspace, pid, action, nonce, body]))
		.digest('hex')
}

export async function withUiStartupLock<T>(workspace: string, run: (workspace: string) => Promise<T>) {
	const folder = join(workspace, '.checkmate', 'tmp')
	mkdirSync(folder, { recursive: true })
	const lock = new DatabaseSync(join(folder, 'ui-startup.sqlite'))
	try {
		const deadline = Date.now() + 15_000
		for (;;) {
			try {
				lock.exec('BEGIN IMMEDIATE')
				break
			} catch (error) {
				if (!isBusy(error) || Date.now() >= deadline) throw error
				await delay(50)
			}
		}
		return await run(realpathSync(workspace))
	} finally {
		lock.close()
	}
}

function uiMarker(workspace: string) {
	try {
		const file = JSON.parse(readFileSync(uiFilePath(workspace), 'utf8'))
		if (
			Number.isInteger(file.port) &&
			file.port > 0 &&
			file.port <= 65535 &&
			Number.isSafeInteger(file.pid) &&
			file.pid > 0
		)
			return file as { port: number; pid: number; hookToken: unknown }
	} catch {}
	return null
}

function requestProof(url: URL, headers: Record<string, string>) {
	return new Promise<{ status: number; body: string; proof: string | string[] | undefined }>((resolve, reject) => {
		const req = request(
			url,
			{ method: 'POST', agent: false, headers, signal: AbortSignal.timeout(2000) },
			(res) => {
				let body = ''
				res.setEncoding('utf8')
				res.on('data', (chunk: string) => {
					body += chunk
					if (body.length > 1024) req.destroy(new Error('Invalid UI response.'))
				})
				res.on('error', reject)
				res.on('end', () =>
					resolve({ status: res.statusCode ?? 0, body, proof: res.headers['x-checkmate-proof'] })
				)
			}
		)
		req.on('error', reject)
		req.end()
	})
}

export async function contactUi(workspace: string, action: LifecycleAction) {
	const marker = uiMarker(workspace)
	if (!marker) return null
	const { port, pid, hookToken } = marker
	const url = `http://127.0.0.1:${port}/`
	const nonce = randomBytes(24).toString('hex')
	const unverified = () =>
		new Error(
			'Could not verify the Checkmate UI. Stop the earlier UI, or remove .checkmate/ui.json if no Checkmate UI runs.'
		)
	let token = ''
	try {
		token = readFileSync(hookTokenPath(workspace), 'utf8').trim()
	} catch {}
	const signed = /^[0-9a-f]{64}$/.test(token) && token === hookToken
	let response
	try {
		response = await requestProof(new URL(lifecyclePath, url), {
			'X-Checkmate-Action': action,
			'X-Checkmate-Nonce': nonce,
			'X-Checkmate-Proof': signed ? lifecycleProof(token, workspace, pid, action, nonce) : '',
		})
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw unverified()
		rmSync(uiFilePath(workspace), { force: true })
		return null
	}
	const { status, body, proof } = response
	const expected = lifecycleProof(token, workspace, pid, action, nonce, body)
	if (
		!signed ||
		status !== 200 ||
		typeof proof !== 'string' ||
		!/^[0-9a-f]{64}$/.test(proof) ||
		!timingSafeEqual(Buffer.from(proof), Buffer.from(expected))
	)
		throw unverified()
	const { harness } = JSON.parse(body)
	if (harness !== 'pi' && harness !== 'claude') throw unverified()
	if (action === 'stop') {
		const deadline = Date.now() + 10_000
		while (uiMarker(workspace)?.pid === pid) {
			if (Date.now() >= deadline) throw new Error('The Checkmate UI is still shutting down.')
			await delay(50)
		}
	}
	return { url, harness: harness as 'pi' | 'claude' }
}
