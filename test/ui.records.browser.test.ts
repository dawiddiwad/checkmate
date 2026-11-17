import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { answerGap } from '../plugin/src/plans.ts'
import { mergedClaims, mergedQuestions, operationLog, planDetail } from '../plugin/src/views.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { entries } from './explorations.ts'
import { launchWith, open, skip, stop } from './browser.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

function read<T>(workspace: string, view: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return view(store)
	} finally {
		closeStore(store)
	}
}

const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).waitFor()
const ready = (page: Page, selector = '[data-row], [data-sub], [data-nav]') =>
	page.waitForFunction((wanted) => document.activeElement?.matches(wanted), selector)

type Step = { path: string; option: number; label: RegExp; done: RegExp | null; field: string | null }

const steps: Step[] = [
	{
		path: '/plans/coupons?item=c%3Ak1%2FD10',
		option: 1,
		label: /Yes, a defect/,
		done: /Accepted coupons · k1\/D10/,
		field: null,
	},
	{
		path: '/plans/coupons?item=c%3Ak1%2FD10',
		option: 2,
		label: /^2\s*No/,
		done: /Rejected coupons · k1\/D10/,
		field: 'reject-text',
	},
	{
		path: '/plans/coupons?item=q%3Ak1%2FQ4',
		option: 1,
		label: /Right/,
		done: /Answered coupons · k1\/Q4/,
		field: null,
	},
	{
		path: '/plans/coupons?item=q%3Ak1%2FQ4',
		option: 2,
		label: /Different/,
		done: /Answered coupons · k1\/Q4/,
		field: 'answer-text',
	},
	{
		path: '/plans/coupons?item=q%3Ak1%2FQ4',
		option: 3,
		label: /Later/,
		done: /Deferred coupons · k1\/Q4/,
		field: null,
	},
	{ path: '/plans/checkout?item=g%3AG2', option: 1, label: /Right/, done: /Answered checkout · G2/, field: null },
	{
		path: '/plans/checkout?item=g%3AG2',
		option: 2,
		label: /Different/,
		done: /Answered checkout · G2/,
		field: 'answer-text',
	},
	{ path: '/plans/checkout?item=g%3AG2', option: 3, label: /Later/, done: /Deferred checkout · G2/, field: null },
	{
		path: '/plans/coupons?item=c%3Ak1%2FD1',
		option: 1,
		label: /Hand over/,
		done: /Handed k1\/D1 over to the payments team/,
		field: 'handoff-text',
	},
	{
		path: '/plans/coupons?item=c%3Ak1%2FD4',
		option: 1,
		label: /Undo hand-over/,
		done: /k1\/D4 not handed over/,
		field: null,
	},
]

for (const how of ['key', 'click'] as const)
	test(`every option of every record kind works inside the record by ${how}`, { skip }, async (t) => {
		for (const step of steps) {
			const { page, url } = await open(t)
			await page.goto(url(step.path))
			await ready(page, '.sp-dhead')
			const option = page.locator('[data-drawer] .sp-dhead [data-option]').nth(step.option - 1)
			assert.match((await option.textContent()) ?? '', step.label, `${step.path} ${step.option}`)
			if (how === 'key') await page.keyboard.press(String(step.option))
			else await option.click()
			if (step.field) {
				await page.waitForFunction((id) => document.activeElement?.id === id, step.field)
				assert.equal(await page.locator('.hl').count(), 1, `${step.path}: one highlight`)
				await page.keyboard.type(
					step.field === 'handoff-text' ? 'the payments team' : 'A reason in one sentence.'
				)
				if (how === 'key') await page.keyboard.press('Enter')
				else await page.locator(`[data-drawer] #${step.field.replace('-text', '')} button.pri`).click()
			}
			await toast(page, step.done!)
		}
	})

test(
	'the last row stays clear of the bulk bar, the toast, and the status bar on short windows',
	{ skip },
	async (t) => {
		const { page, url } = await open(t)
		const overlap = () =>
			page.evaluate(() => {
				const row = document.querySelector('.hl[data-row]')!.getBoundingClientRect()
				const covers = ['[data-bulk]:not([hidden])', '.toast', '.statusbar']
					.map((selector) => document.querySelector(selector))
					.filter(
						(element): element is Element => Boolean(element) && (element as HTMLElement).offsetHeight > 0
					)
					.map((element) => element.getBoundingClientRect())
				return covers.some(
					(box) =>
						Math.min(row.bottom, box.bottom) - Math.max(row.top, box.top) > 0.5 &&
						box.left < row.right &&
						box.right > row.left
				)
			})
		for (const [width, height] of [
			[1440, 900],
			[1440, 500],
			[760, 700],
			[400, 700],
		]) {
			await page.setViewportSize({ width, height })
			await page.goto(url('/plans/coupons?view=all&focus=list'))
			await ready(page, '[data-row]')
			await page.keyboard.press('Space')
			for (let step = 0; step < 30; step++) await page.keyboard.press('ArrowDown')
			assert.equal(await overlap(), false, `bulk bar at ${width}x${height}`)
			await page.goto(url('/plans/coupons?view=needs&focus=list'))
			await ready(page, '[data-row]')
			await page.keyboard.press('1')
			await page.locator('.toast').waitFor()
			await ready(page, '[data-row]')
			assert.equal(await overlap(), false, `toast at ${width}x${height}`)
		}
		await page.setViewportSize({ width: 400, height: 500 })
		await page.goto(url('/'))
		await ready(page, '[data-row]')
		for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowDown')
		assert.equal(await overlap(), false, 'home at 400x500')
	}
)

test('the arrows and Space scroll a page that has nothing to move to, and say nothing', { skip }, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 1440, height: 600 } })
	for (const path of ['/settings/targets/shop-local', '/plans/basket/request', '/plans/checkout@2']) {
		await page.goto(url(path))
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('Space')
		await page.waitForFunction(() => window.scrollY > 0)
		assert.equal(await page.locator('[data-say]').textContent(), '', path)
	}
	await page.goto(url('/log'))
	await page.keyboard.press('Space')
	await page.waitForFunction(() => window.scrollY > 0)
	assert.equal(await page.locator('[data-say]').textContent(), '')
})

test('a row decided in another session hands the highlight to its neighbour and says so', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list&at=q%3Ak1%2FQ8'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'q:k1/Q8')
	read(workspace, (store) =>
		answerGap(store, 'qa-lead', {
			planId: 'coupons',
			gapId: 'k1/Q8',
			kind: 'defer',
			value: 'Later.',
			rationale: 'Elsewhere.',
		})
	)
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'q:k1/Q9')
	assert.match(page.url(), /at=q%3Ak1%2FQ9/)
	assert.match((await page.locator('[data-say]').textContent()) ?? '', /k1\/Q8 was answered in another session/)
})

test('a deferred question says Deferred in the toast, the badge, and the list', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list&at=q%3Ak1%2FQ4'))
	await ready(page, '[data-row]')
	await page.keyboard.press('3')
	await toast(page, 'Deferred coupons · k1/Q4')
	await page.goto(url('/plans/coupons?view=all'))
	const row = page.locator('[data-panel="all"] [data-key="q:k1/Q4"]')
	assert.match((await row.textContent()) ?? '', /Deferred[\s\S]*deferred/)
	assert.equal(await page.locator('[data-panel="all"] .sp-gh', { hasText: 'Deferred questions' }).count(), 1)
	assert.equal(
		read(workspace, (store) => mergedQuestions(store, 'coupons').find((item) => item.id === 'k1/Q4')!.answer),
		'Deferred in the review UI.'
	)
})

test('Home lists the plans that need you first and returns to the plan you left', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/'))
	await ready(page, '[data-row]')
	const plans = await page
		.locator('[data-row]')
		.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.key))
	assert.equal(plans.at(-1), 'plan:account')
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-key')), plans[0])
	const coupons = plans.indexOf('plan:coupons')
	for (let step = 0; step < coupons; step++) await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowRight')
	await page.waitForURL(/\/plans\/coupons/)
	await ready(page, '[data-nav]')
	await page.keyboard.press('ArrowLeft')
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'plan:coupons')
})

test('Enter on an empty find query does nothing, and a message clears on the next key', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await ready(page, '[data-row]')
	await page.keyboard.press('9')
	assert.match((await page.locator('[data-say]').textContent()) ?? '', /options go from 1 to 2/)
	await page.keyboard.press('0')
	assert.equal(await page.locator('[data-say]').textContent(), '')
	const before = page.url()
	await page.keyboard.press('/')
	await page.getByRole('dialog', { name: 'Find' }).waitFor()
	await page.keyboard.press('Enter')
	await page.waitForTimeout(300)
	assert.equal(page.url(), before)
	assert(await page.getByRole('dialog', { name: 'Find' }).isVisible())
})

test('summaries, More, and the navigator show hover and pressed states', { skip }, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 1100, height: 800 } })
	const background = (selector: string) =>
		page
			.locator(selector)
			.first()
			.evaluate((element) => getComputedStyle(element).backgroundColor)
	for (const [path, selector] of [
		['/plans/checkout@2', 'details.fold > summary'],
		['/plans/checkout@2', '.sb-more > summary'],
	]) {
		await page.goto(url(path))
		const before = await background(selector)
		await page.locator(selector).first().hover()
		assert.notEqual(await background(selector), before, `${selector} hover`)
	}
	await page.goto(url('/plans/coupons?view=all'))
	const row = '[data-nav][data-target="needs"]'
	const before = await background(row)
	await page.locator(row).hover()
	await page.mouse.down()
	assert.notEqual(await background(row), before)
	await page.mouse.up()
})

test('without JavaScript a record opens from its row and takes a decision and a reason', { skip }, async (t) => {
	const { page, url, workspace } = await open(t, { javaScriptEnabled: false })
	await page.goto(url('/plans/coupons?view=needs'))
	await page.locator('[data-panel="needs"] [data-key="c:k1/D10"] a.sp-c-title').click()
	await page.waitForURL(/item=c%3Ak1%2FD10/)
	await page.locator('[data-drawer] button[data-option]', { hasText: 'Yes, a defect' }).click()
	await toast(page, 'Accepted coupons · k1/D10')
	await page.goto(url('/plans/coupons?view=needs'))
	await page.locator('[data-panel="needs"] [data-key="c:k1/D12"] a.sp-c-title').click()
	await page.locator('[data-drawer] #reject-text').fill('Fifty tries are allowed for partners.')
	await page.locator('[data-drawer] #reject button.pri').click()
	await toast(page, 'Rejected coupons · k1/D12')
	const states = read(workspace, (store) => mergedClaims(store, 'coupons'))
	assert.equal(states.find((claim) => claim.id === 'k1/D10')!.state, 'accepted')
	assert.equal(states.find((claim) => claim.id === 'k1/D12')!.state, 'rejected')
})

test('a key pressed while a decision is sent records one decision and acts on nothing else', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	const decisions = () =>
		read(
			workspace,
			(store) => operationLog(store, { limit: 1000 }).filter((row) => row.command === 'claim accept').length
		)
	const before = decisions()
	await page.route('**/claims/**', async (route) => {
		if (route.request().method() === 'POST') await new Promise((done) => setTimeout(done, 400))
		await route.continue()
	})
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await ready(page, '[data-row]')
	await page.keyboard.press('1')
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('1')
	await toast(page, 'Accepted coupons · k1/D10')
	assert.equal(decisions(), before + 1)
})

test('the plan editor saves and refuses by keys only', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/search@1/edit'))
	const title = page.locator('#edit-T2').getByLabel('Title')
	await title.focus()
	await page.keyboard.press('Control+a')
	await page.keyboard.type('Helpful empty state')
	await page.keyboard.press('Control+Enter')
	await page.waitForURL(/\/plans\/search@1$/)
	await toast(page, 'Saved search@1 in place')
	assert.equal(
		read(workspace, (store) => planDetail(store, 'search').plan.tests[1].title),
		'Helpful empty state'
	)
	await page.goto(url('/plans/search@1/edit'))
	await page.getByText('Edit as JSON').focus()
	await page.keyboard.press('Enter')
	const json = page.getByLabel('Plan candidate JSON')
	await json.focus()
	await page.keyboard.press('Control+a')
	await page.keyboard.type('{ not json')
	await page.keyboard.press('Control+Enter')
	await page.getByText(/The JSON is not valid/).waitFor()
	await page.keyboard.press('Escape')
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/plans\/search@1$/)
})

test('Settings adds and retires an instance by keys only', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/settings/targets/shop-local'))
	await page.getByLabel('Instance ID').focus()
	await page.keyboard.type('uat')
	await page.keyboard.press('Tab')
	await page.keyboard.type('https://uat.shop.example')
	await page.keyboard.press('Control+Enter')
	await toast(page, 'Added instance uat to shop-local')
	await page.locator('#instance-uat summary', { hasText: 'Retire' }).focus()
	await page.keyboard.press('Enter')
	await page.locator('#instance-uat').getByRole('button', { name: 'Confirm retire' }).focus()
	await page.keyboard.press('Enter')
	await toast(page, 'Retired instance uat of shop-local')
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/settings\/targets$/)
})

test('the request page, the run page, and the testers view step in and out by keys only', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/basket/request'))
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/plans\/basket$/)
	await page.goto(url('/runs/run-7'))
	await ready(page, '[data-row]')
	while ((await page.evaluate(() => document.activeElement?.getAttribute('data-key'))) !== 'finding:F1')
		await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowRight')
	await page.waitForURL(/item=finding%3AF1/)
	await page.locator('[data-region="run-detail"] .finding').waitFor()
	await page.keyboard.press('ArrowLeft')
	await page.waitForURL(/\/runs\/run-7$/)
	await page.goto(url('/explorations/x-1'))
	await ready(page, '[data-row]')
	while ((await page.evaluate(() => document.activeElement?.getAttribute('data-key'))) !== 'explorer:a1')
		await page.keyboard.press('ArrowDown')
	await page.keyboard.press('Enter')
	await page.waitForURL(/item=explorer%3Aa1/)
	const evidence = page.locator('[data-region="exploration-detail"] a[data-view="image"]').first()
	await evidence.focus()
	await page.keyboard.press('Enter')
	const viewer = page.getByRole('dialog', { name: 'Evidence viewer' })
	await viewer.waitFor()
	await page.keyboard.press('Escape')
	await viewer.waitFor({ state: 'hidden' })
	await page.keyboard.press('ArrowLeft')
	await page.waitForURL(/\/explorations\/x-1$/)
	await page.keyboard.press('ArrowLeft')
	await page.waitForURL(/\/plans\/checkout$/)
})

test('the rule and build marks follow a live update, and the build columns still choose', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=area%3ACodes'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await ready(page, '[data-nav]')
	const mark = page.locator('[data-nav][data-target="rule:R2"] [data-mark="fixture-build-3"]')
	assert.match((await mark.getAttribute('class')) ?? '', /k-pass/)
	read(workspace, (store) =>
		entries(store, 'x-13', 'k2', [
			{ kind: 'criterion', id: 'C999', rule: 'R2', text: 'R2 again.', verdict: 'wrong' },
		])
	)
	await page.waitForFunction(() =>
		document
			.querySelector('[data-nav][data-target="rule:R2"] [data-mark="fixture-build-3"]')
			?.classList.contains('k-fail')
	)
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-target')), 'area:Codes')
	const all = await page.locator('[data-panel="area:Codes"] [data-row]:visible').count()
	await page.keyboard.press('1')
	assert(
		(await page.locator('[data-panel="area:Codes"] [data-row]:visible').count()) < all,
		'build 1 shows fewer rows'
	)
})

test('with a record open, the title of each row takes the rest of the row at every width', { skip }, async (t) => {
	const { page, url } = await open(t)
	for (const width of [1440, 1240, 1100, 900, 760, 400]) {
		await page.setViewportSize({ width, height: 900 })
		await page.goto(url('/plans/coupons?view=needs&item=c%3Ak1%2FD12'))
		await page.locator('[data-drawer]').waitFor()
		const gaps = await page
			.locator('[data-panel="needs"] [data-row] .sp-c-title')
			.evaluateAll((titles) =>
				titles.map(
					(title) =>
						title.closest('[data-row]')!.getBoundingClientRect().right - title.getBoundingClientRect().right
				)
			)
		assert(gaps.length > 0)
		for (const gap of gaps) assert(gap < 24, `${width}: ${gap} px after the title`)
	}
})
