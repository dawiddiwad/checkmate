import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { request } from 'node:http'
import { setTimeout as pause } from 'node:timers/promises'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { directory, plan, root, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

export async function waitFor<T>(what: string, look: () => T | undefined | false) {
	const until = Date.now() + 30000
	for (;;) {
		const found = look()
		if (found) return found
		if (Date.now() > until) assert.fail(`Timed out: ${what}`)
		await pause(20)
	}
}

export function workspaceWithFake(t: TestContext, replies: Parameters<typeof fakeClaude>[1]) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const fake = fakeClaude(t, replies)
	mkdirSync(join(fake.config, 'plugins'), { recursive: true })
	writeFileSync(
		join(fake.config, 'plugins', 'installed_plugins.json'),
		JSON.stringify({ version: 2, plugins: { 'checkmate@checkmate': [{ installPath: join(root, 'plugin') }] } })
	)
	const env = { ...process.env, ...fake.env, CHECKMATE_ACTOR: undefined }
	const read = <T>(view: (reading: ReturnType<typeof openStore>) => T) => {
		const reading = openStore(workspace)
		try {
			return view(reading)
		} finally {
			closeStore(reading)
		}
	}
	const pids = (explorationId: string) =>
		read((reading) => {
			const events = explorationEvents(reading, explorationId)
			return {
				supervisor: events.findLast((item) => item.step === 'supervisor')?.detail.pid as number | undefined,
				children: events.filter((item) => item.step === 'child').map((item) => item.detail.pid as number),
			}
		})
	return { ...fake, workspace, env, read, pids }
}

export async function postAs(ui: { url: string }, actor: string, path: string, form: Record<string, string>) {
	const page = await fetch(new URL('/plans/checkout', ui.url))
	const csrf = /name="csrf" value="([0-9a-f]+)"/.exec(await page.text())![1]
	return fetch(new URL(path, ui.url), {
		method: 'POST',
		redirect: 'manual',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `checkmate_actor=${actor}` },
		body: new URLSearchParams({ csrf, ...form }),
	})
}

type Reply = { status: number; headers: Record<string, unknown>; body: string }

export function call(
	ui: { url: string },
	path: string,
	form?: Record<string, string>,
	headers: Record<string, string> = {}
) {
	const body = form ? new URLSearchParams(form).toString() : undefined
	return new Promise<Reply>((resolve, reject) => {
		const req = request(
			new URL(path, ui.url),
			{
				method: body === undefined ? 'GET' : 'POST',
				headers: {
					...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
					...headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(chunk))
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString(),
					})
				)
			}
		)
		req.on('error', reject)
		req.end(body)
	})
}

export const token = (page: string) => /name="csrf" value="([0-9a-f]+)"/.exec(page)![1]

export function endProcessesIn(workspace: string) {
	for (const entry of readdirSync('/proc').filter((name) => /^[0-9]+$/.test(name))) {
		try {
			if (realpathSync(`/proc/${entry}/cwd`) !== workspace) continue
			process.kill(-Number(entry), 'SIGKILL')
		} catch {}
		try {
			process.kill(Number(entry), 'SIGKILL')
		} catch {}
	}
}
