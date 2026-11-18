import type { TestContext } from 'node:test'
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright-core'
import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { startUi } from '../plugin/src/ui/server.ts'
import { human, seedDemo } from '../scripts/ui-demo.ts'
import { seededProcesses } from '../scripts/ui-volume.ts'
import { closeStore, openStore, planDetail } from '../plugin/src/index.ts'
import { copied, directory, root } from './support.ts'

const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const skip = executablePath ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'
export const browserTest = { skip, timeout: 60_000 }
const closeWait = 10_000
const commandWait = 30_000
const run = promisify(execFile)
const template = directory()
let browser: Browser | undefined

export function launch() {
	return launchWith(seedDemo)
}

export async function launchWith(seed: (workspace: string) => void) {
	if (!executablePath) return
	seed(template)
	browser = await chromium.launch({ executablePath })
}

function bounded(work: Promise<unknown> | undefined) {
	return Promise.race([work?.catch(() => {}), new Promise((resolve) => setTimeout(resolve, closeWait).unref())])
}

export async function stop() {
	await bounded(browser?.close())
	for (const seeded of seededProcesses.splice(0)) seeded.kill('SIGKILL')
	rmSync(template, { recursive: true, force: true })
}

export function open(t: TestContext, options: BrowserContextOptions = {}, env?: Record<string, string | undefined>) {
	return openIn(t, copied(t, template), options, env)
}

export async function openIn(
	t: TestContext,
	workspace: string,
	options: BrowserContextOptions = {},
	env?: Record<string, string | undefined>
) {
	const ui = await startUi({ workspace, env })
	const contexts: BrowserContext[] = []
	t.after(async () => {
		for (const opened of contexts) await bounded(opened.close())
		await bounded(ui.close())
	})
	const context = await browser!.newContext({ viewport: { width: 1280, height: 900 }, ...options })
	contexts.push(context)
	context.setDefaultTimeout(5000)
	await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
	const errors: string[] = []
	context.on('page', (opened) => opened.on('pageerror', (error) => errors.push(error.message)))
	const page = await context.newPage()
	t.after(() => assert.deepEqual(errors, [], 'the page threw an error'))
	const url = (path: string) => new URL(path, ui.url).href
	return { workspace, ui, page, url, context }
}

export function checkmate(workspace: string, args: string[]) {
	return run(
		process.execPath,
		[join(root, 'plugin/dist/checkmate.js'), ...args, '--workspace', workspace, '--actor', 'worker'],
		{ timeout: commandWait }
	)
}

export function approval(workspace: string, planId: string) {
	const store = openStore(workspace)
	try {
		return planDetail(store, planId).approval
	} finally {
		closeStore(store)
	}
}

export const focusedKey = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key ?? null)
