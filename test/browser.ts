import type { TestContext } from 'node:test'
import type { Browser, BrowserContextOptions, Page } from 'playwright-core'
import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { startUi } from '../plugin/src/ui/server.ts'
import { human, seedDemo } from '../scripts/ui-demo.ts'
import { closeStore, openStore, planDetail } from '../plugin/src/index.ts'
import { copied, directory, root } from './support.ts'

const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
export const skip = executablePath ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'
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

export async function stop() {
	await browser?.close()
	rmSync(template, { recursive: true, force: true })
}

export async function open(t: TestContext, options: BrowserContextOptions = {}) {
	const workspace = copied(t, template)
	const ui = await startUi({ workspace })
	const context = await browser!.newContext({ viewport: { width: 1280, height: 900 }, ...options })
	context.setDefaultTimeout(5000)
	await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
	t.after(async () => {
		await context.close()
		await ui.close()
	})
	const errors: string[] = []
	context.on('page', (opened) => opened.on('pageerror', (error) => errors.push(error.message)))
	const page = await context.newPage()
	t.after(() => assert.deepEqual(errors, [], 'the page threw an error'))
	const url = (path: string) => new URL(path, ui.url).href
	return { workspace, ui, page, url }
}

export function checkmate(workspace: string, args: string[]) {
	return run(process.execPath, [
		join(root, 'plugin/dist/checkmate.js'),
		...args,
		'--workspace',
		workspace,
		'--actor',
		'worker',
	])
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
