import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	addInstance,
	approvePlan,
	beginRun,
	checkAssertion,
	closeStore,
	closeTest,
	finishRun,
	openPlan,
	openStore,
	recordFinding,
	savePlan,
} from '../plugin/src/index.ts'
import { evidenceFile } from './support.ts'
import { checkmate, launch, open, skip, stop } from './browser.ts'

test.before(launch)
test.after(stop)

const long = `Long${'Token'.repeat(60)}`

function seedLong(workspace: string) {
	const store = openStore(workspace)
	try {
		addInstance(store, long, {
			targetId: 'shop-local',
			instanceId: 'wide',
			instance: { entries: { web: `https://shop.example/${long}` }, environment: long },
		})
		openPlan(store, long, {
			planId: 'wide',
			target: 'shop-local@1',
			request: {
				objective: long,
				requirements: [{ id: 'W1', text: long, source: `brief://${long}`, metadata: { note: long } }],
				sourceContext: [],
			},
		})
		savePlan(store, long, {
			planId: 'wide',
			candidate: {
				tests: [
					{
						id: 'T1',
						title: long.slice(0, 200),
						requirementIds: ['W1'],
						capability: 'browser',
						operations: ['read_catalog'],
						dependsOn: [],
						preconditions: [long],
						action: long,
						metadata: { note: long },
						assertions: [{ id: 'A1', check: long, checkKind: 'deterministic' }],
					},
				],
				gaps: [
					{
						id: 'G1',
						severity: 'non_blocking',
						status: 'open',
						requirementIds: ['W1'],
						testIds: ['T1'],
						question: long,
						consequence: long,
						decisionId: null,
					},
				],
			},
		})
		approvePlan(store, long, { reference: 'wide@1', rationale: long })
		beginRun(store, long, { runId: 'run-wide', reference: 'wide@1', tests: ['T1'], build: 'b1', instance: 'wide' })
		const reply = checkAssertion(store, long, {
			runId: 'run-wide',
			testId: 'T1',
			assertionId: 'A1',
			result: 'failed',
			observed: long,
			evidence: [evidenceFile(store, 'run-wide', 'observed.txt', long)],
		})
		recordFinding(store, long, {
			runId: 'run-wide',
			finding: {
				id: 'F1',
				type: 'defect',
				severity: 'high',
				assertionIds: ['T1.A1'],
				requirementIds: ['W1'],
				title: long.slice(0, 200),
				expected: long,
				observed: long,
				reproduction: [long],
				evidenceIds: reply.data.evidenceIds as string[],
				metadata: { note: long },
			},
		})
		closeTest(store, long, { runId: 'run-wide', testId: 'T1' })
		finishRun(store, long, {
			runId: 'run-wide',
			completion: 'completed',
			cleanup: 'completed',
			cleanupReason: long,
		})
	} finally {
		closeStore(store)
	}
}

test('a run page updates live and keeps typed text', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/runs/run-8'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.locator('[data-key="T1.A2"] .obs', { hasText: 'No result yet.' }).waitFor()
	const evidence = join(workspace, '.checkmate', 'tmp', 'run-8')
	mkdirSync(evidence, { recursive: true })
	writeFileSync(join(evidence, 'cookie.txt'), 'Set-Cookie: sid=x; HttpOnly\n')
	await checkmate(workspace, [
		'run',
		'check',
		'run-8',
		'T1',
		'A2',
		'--result',
		'passed',
		'--observed',
		'HttpOnly flag present',
		'--evidence',
		'.checkmate/tmp/run-8/cookie.txt',
	])
	await page.locator('[data-key="T1.A2"]', { hasText: 'HttpOnly flag present' }).waitFor({ timeout: 2000 })
	await page.locator('[aria-live="polite"]', { hasText: 'T1.A2 passed' }).waitFor({ state: 'attached' })
	await page.goto(url('/runs/run-7'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.getByLabel('Rationale').fill('Half-written rationale')
	await checkmate(workspace, ['result', 'accept', 'run-7', '--rationale', 'Accepted elsewhere.'])
	await page.locator('[data-region="state"]', { hasText: 'accepted' }).waitFor({ timeout: 2000 })
	await page.locator('.banner', { hasText: 'run-7 was accepted by worker. Review it before you decide.' }).waitFor()
	assert.equal(await page.getByLabel('Rationale').inputValue(), 'Half-written rationale')
	assert.match(page.url(), /\/runs\/run-7$/)
})

test('dark mode follows the system and the header toggle overrides it', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.emulateMedia({ colorScheme: 'dark' })
	await page.goto(url('/runs/run-7'))
	const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
	assert.equal(await background(), 'rgb(18, 23, 21)')
	await page.getByRole('button', { name: /^Theme: system/ }).click()
	assert.equal(await background(), 'rgb(246, 247, 245)')
	await page.reload()
	assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light')
})

test('list filters, sorting, and pages update in place, keep the URL, and update live', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/log'))
	await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1))
	const marker = () => page.evaluate(() => (window as unknown as { marker?: number }).marker)
	assert(!(await page.getByRole('button', { name: 'Filter' }).isVisible()))
	const count = page.locator('[data-list-count]')
	await count.filter({ hasText: /^Showing 1–25 of \d+ operations$/ }).waitFor()
	await page.getByRole('link', { name: 'Next ›' }).click()
	await page.waitForURL(/\/log\?page=2$/)
	await count.filter({ hasText: /^Showing 26–50/ }).waitFor()
	await page.getByLabel('Rows per page').selectOption('50')
	await page.waitForURL(/\/log\?size=50$/)
	await page.getByLabel('Search operations').pressSequentially('approve')
	await page.waitForURL(/\/log\?q=approve&size=50$/)
	await count.filter({ hasText: /^Showing 1–\d+ of \d+ operations$/ }).waitFor()
	const commands = await page.locator('tbody tr td:nth-child(3) .mono').allTextContents()
	assert(commands.length > 0 && commands.every((command) => command === 'plan approve'))
	assert.equal(await page.getByLabel('Search operations').evaluate((input) => input === document.activeElement), true)
	await page.getByLabel('Actor').selectOption('qa-lead')
	await page.waitForURL(/actor=qa-lead/)
	await page.getByRole('link', { name: /^Actor/ }).click()
	await page.waitForURL(/sort=actor&dir=asc/)
	await page.locator('th[aria-sort="ascending"]', { hasText: 'Actor' }).waitFor()
	await page.goBack()
	await page.waitForURL(/\/log\?q=approve&actor=qa-lead&size=50$/)
	await page.locator('th[aria-sort="descending"]', { hasText: 'Time' }).waitFor()
	await page.getByRole('link', { name: 'Clear' }).click()
	await page.waitForURL(/\/log$/)
	assert.equal(await page.getByLabel('Search operations').inputValue(), '')
	assert.equal(await page.getByLabel('Actor').inputValue(), '')
	assert.equal(await page.getByLabel('Rows per page').inputValue(), '25')
	assert.equal(await marker(), 1)
	await page.goto(url('/plans'))
	await page.getByLabel('Search plans').fill('login')
	await page.waitForURL(/\/plans\?q=login$/)
	await page.locator('[data-list-count]', { hasText: 'Showing 1–1 of 1 plan' }).waitFor()
	await page.goto(url('/plans?q=search'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.locator('tr[data-key="plan:search"]', { hasText: 'pending' }).waitFor()
	await checkmate(workspace, ['plan', 'approve', 'search@1', '--rationale', 'Approved elsewhere.'])
	await page.locator('tr[data-key="plan:search"]', { hasText: 'approved' }).waitFor({ timeout: 2000 })
	assert.match(page.url(), /\/plans\?q=search$/)
})

test('the plan page folds closed gaps and loads the full history on demand', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/checkout@2'))
	const closed = page.locator('#G1 details')
	assert.equal(await closed.evaluate((details) => (details as HTMLDetailsElement).open), false)
	assert(Number(await page.locator('#G1 summary').evaluate((summary) => getComputedStyle(summary).opacity)) < 1)
	await page.locator('#G1 summary').click()
	await page.locator('#G1 .gap-b').waitFor()
	await page.locator('#runs').scrollIntoViewIfNeeded()
	await page.locator('[data-region="plan-runs"] a', { hasText: 'run-7' }).waitFor()
	await page.goto(url('/plans/account@7'))
	const entries = page.locator('[data-history] ol.history > li')
	assert.equal(await entries.count(), 6)
	assert.equal(await page.locator('[data-history] details[open]').count(), 1)
	await page.getByText('Show full history · 1 earlier revision').click()
	await page.locator('[data-history] summary', { hasText: 'account@1' }).waitFor()
	assert.equal(await entries.count(), 7)
	assert.equal(new URL(page.url()).search, '')
	await page.reload()
	assert.equal(await entries.count(), 6)
})

test('a finished run downloads its report', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/runs/run-7'))
	await page.getByText('Download report').click()
	await page.getByText(/print to PDF/).waitFor()
	const waiting = page.waitForEvent('download')
	await page.getByRole('link', { name: /^HTML/ }).click()
	const file = await waiting
	assert.equal(file.suggestedFilename(), 'run-7-report.html')
	const junit = await page.evaluate(async () => {
		const text = await (await fetch('/runs/run-7/report.junit')).text()
		const xml = new DOMParser().parseFromString(text, 'application/xml')
		return {
			errors: xml.getElementsByTagName('parsererror').length,
			cases: xml.querySelectorAll('testsuites > testsuite > testcase').length,
			failure: xml.querySelector('testcase failure')?.getAttribute('message'),
		}
	})
	assert.deepEqual(junit, { errors: 0, cases: 3, failure: 'The promotion stacks with the loyalty credit' })
	await page.keyboard.press('Escape')
	assert.equal(await page.locator('details[data-menu]').evaluate((menu) => (menu as HTMLDetailsElement).open), false)
})

test('Settings adds and retires an instance from the keyboard and updates live', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/'))
	await page.getByRole('link', { name: 'Settings' }).focus()
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/settings\/targets$/)
	await page.getByRole('link', { name: 'shop-local' }).click()
	await page.getByRole('heading', { name: 'shop-local' }).waitFor()
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.getByLabel('Instance ID').fill('uat')
	await page.getByLabel('web url').fill('https://uat.shop.example')
	await page.getByLabel('Environment optional').fill('UAT sandbox')
	await page.getByRole('button', { name: 'Add instance' }).click()
	await page.waitForURL(/#instance-uat$/)
	const row = page.locator('#instance-uat')
	await row.getByText('active').waitFor()
	await row.locator('summary', { hasText: 'Retire' }).focus()
	await page.keyboard.press('Enter')
	await row.getByRole('button', { name: 'Confirm retire' }).click()
	await page.locator('#instance-uat').getByText('retired by qa-lead').waitFor()
	await checkmate(workspace, [
		'target',
		'instance',
		'add',
		'shop-local',
		'eu',
		'--entry',
		'web=https://eu.shop.example',
	])
	await page.locator('#instance-eu').waitFor()
})

async function overflow(page: Awaited<ReturnType<typeof open>>['page']) {
	return page.evaluate(() => {
		const width = window.innerWidth
		if (document.documentElement.scrollWidth <= width) return null
		const wide = [...document.querySelectorAll('body *')]
			.filter((element) => element.getBoundingClientRect().right > width + 1)
			.map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
		return `${document.documentElement.scrollWidth} > ${width}: ${wide.slice(-5).join(' ')}`
	})
}

test('long unbroken values do not widen the page at 1280px and 390px', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	seedLong(workspace)
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 900 })
		const pages = [
			'/',
			'/plans',
			'/runs',
			'/plans/wide@1',
			'/plans/wide@1/gaps/G1',
			'/plans/wide@1/edit',
			'/plans/checkout@2',
			'/plans/checkout@2/edit',
			'/runs/run-wide',
			'/runs/run-7',
			'/settings/targets/shop-local',
		]
		for (const path of pages) {
			await page.goto(url(path))
			assert.equal(await overflow(page), null, path)
		}
		for (const [path, panel] of [
			['/runs/run-7', '#decide'],
			['/plans/wide@1/gaps/G1', '#answer'],
		]) {
			await page.goto(url(path))
			const box = await page.locator(panel).boundingBox()
			assert(box && box.x >= 0 && box.x + box.width <= width, `${path} ${JSON.stringify(box)}`)
		}
	}
})
