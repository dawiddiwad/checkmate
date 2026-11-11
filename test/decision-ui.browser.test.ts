import type { Browser } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { startUi } from '../cli/src/ui/server.ts'
import { human, seedDemo } from '../scripts/ui-demo.ts'
import { closeStore, openStore, planDetail, runDetail } from '../plugin/src/index.ts'
import { directory } from './support.ts'

const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const skip = executablePath ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'
let browser: Browser | undefined

test.before(async () => {
	if (executablePath) browser = await chromium.launch({ executablePath })
})
test.after(async () => {
	await browser?.close()
})

for (const subject of [
	{ path: '/plans/search@1', id: 'search@1', accept: 'Approve', confirm: 'Confirm approval', kind: 'plan' },
	{ path: '/runs/run-7', id: 'run-7', accept: 'Accept', confirm: 'Confirm acceptance', kind: 'result' },
]) {
	test(`${subject.kind} decisions can be reversed through the visible form`, { skip }, async (t) => {
		const workspace = directory(t)
		seedDemo(workspace)
		const ui = await startUi({ workspace })
		const context = await browser!.newContext({ viewport: { width: 1280, height: 900 } })
		context.setDefaultTimeout(5000)
		await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
		t.after(async () => {
			await context.close()
			await ui.close()
		})
		const page = await context.newPage()
		const store = openStore(workspace)
		t.after(() => closeStore(store))
		const decision = () =>
			subject.kind === 'plan'
				? planDetail(store, 'search', 1).approval.latest
				: runDetail(store, 'run-7').result!.latestDecision
		const snapshot = () =>
			subject.kind === 'plan'
				? planDetail(store, 'search', 1).plan
				: store.db.prepare('SELECT body FROM results WHERE run_id = ?').get(subject.id)
		const before = snapshot()
		for (const verdict of ['approved', 'rejected', 'approved'] as const) {
			await page.goto(new URL(subject.path, ui.url).href)
			const previous = decision()
			const form = page.locator('[data-region="decision"]')
			if (previous) {
				assert.match(await form.innerText(), /Change decision for/)
				assert.equal(await form.locator('blockquote').innerText(), previous.rationale)
			}
			assert.equal(await page.getByLabel('Rationale').inputValue(), '')
			const choice = page.getByRole('button', {
				name: verdict === 'rejected' ? 'Reject' : `${subject.accept} ${subject.id}`,
				exact: true,
			})
			assert(await choice.isDisabled())
			const rationale = `${verdict}: review ${store.db.prepare('SELECT COUNT(*) AS count FROM approvals').get()!.count}`
			await page.getByLabel('Rationale').fill(rationale)
			await choice.click()
			assert.deepEqual(decision(), previous)
			const response = page.waitForResponse(
				(reply) => reply.request().method() === 'POST' && new URL(reply.url()).pathname === subject.path
			)
			await page
				.getByRole('button', {
					name: verdict === 'rejected' ? 'Confirm rejection' : subject.confirm,
					exact: true,
				})
				.click()
			assert.equal((await response).status(), 303)
			assert.equal(decision()!.verdict, verdict)
			assert.equal(decision()!.rationale, rationale)
			assert.equal(decision()!.actor, human)
			assert.deepEqual(snapshot(), before)
		}
		const rows = store.db
			.prepare(
				'SELECT verdict, rationale FROM approvals WHERE subject_kind = ? AND subject_id = ? ORDER BY rowid'
			)
			.all(subject.kind, subject.id)
		assert.deepEqual(
			rows.map((row) => row.verdict),
			['approved', 'rejected', 'approved']
		)
		assert.equal(new Set(rows.map((row) => row.rationale)).size, 3)
	})
}
