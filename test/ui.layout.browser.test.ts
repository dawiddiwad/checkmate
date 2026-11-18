import test from 'node:test'
import assert from 'node:assert/strict'
import { seedVolume } from '../scripts/ui-volume.ts'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { decideClaim } from '../plugin/src/journal.ts'
import { answerGap } from '../plugin/src/plans.ts'
import { launchWith, open, browserTest, stop } from './browser.ts'
import { files } from './explorations.ts'
import { check, measure } from './layout.ts'
import { asking, bash, openOf, seedHistory, waitOpen } from './permissions.ts'
import { addRequestActivity, askRequest, recordRequestEvent, setRequestState } from '../plugin/src/requests.ts'

test.before(() => launchWith(seedVolume))

function read<T>(workspace: string, view: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return view(store)
	} finally {
		closeStore(store)
	}
}
test.after(stop)

const pages = [
	'/',
	'/plans/coupons?view=needs&focus=list&at=q%3Ak1%2FQ4',
	'/plans/coupons?view=all&focus=list',
	'/plans/coupons?view=area%3ACodes',
	'/plans/coupons?view=all&item=c%3Ak1%2FD1',
	'/plans/checkout?view=needs&focus=list',
	'/explorations/x-9',
	'/runs/run-7',
	'/runs',
	'/log',
	'/plans/checkout@2',
	'/plans/checkout@2/edit',
	'/settings/targets/shop-local',
	'/runs/run-7?item=finding%3AF1',
	'/plans/account@7/edit',
	'/settings/targets',
	'/explorations/x-1?item=explorer%3Aa1',
	'/plans/basket/request',
	'/plans/checkout@2/gaps/G2',
	'/actor',
	'/activity',
	'/activity?size=25&page=1',
	'/explorations/x-14',
	'/explorations/x-14?item=explorer%3Aa1',
	'/explorations/x-15',
	'/explorations/x-17',
	'/explorations/x-16',
	'/settings/claude',
	'/plans/login',
	'/plans/account',
	'/new',
	'/setup',
]

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`rows, marks, keys, and colours line up at 1440, 900, and 400 in the ${colorScheme} theme`,
		browserTest,
		async (t) => {
			const { page, url } = await open(t)
			for (const width of [1440, 900, 400])
				for (const path of pages) await check(page, url(path), width, colorScheme)
		}
	)

test('what a finger hits is at least 40 px at 760, 600, and 400', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const width of [760, 600, 400]) for (const path of pages) await check(page, url(path), width, 'light', / px$/)
})

test('a saved file of a tester is a target of 40 px at 760, 600, and 400', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	read(workspace, (store) => files(store, 'x-9', 'a1', 'test', { 'plan.md': 'The plan.\n' }))
	for (const width of [760, 600, 400]) await check(page, url('/explorations/x-9'), width, 'light', / px$/)
	assert.match((await page.locator('a[data-view]', { hasText: 'plan.md' }).first().textContent()) ?? '', /plan\.md/)
})

const longCommand =
	`cd /home/user/projects/checkmate-demo/a/very/long/absolute/path/to/the/application/under/test && ${'curl -sS -i -X POST -H "Content-Type: application/json" -d \'{"name":"x"}\' http://127.0.0.1:9911/api/notes?page=1 && '.repeat(3)}echo done`.slice(
		0,
		400
	)

const asked = [
	[
		'a1',
		bash(
			longCommand,
			'curl -sS *',
			'/home/user/projects/checkmate-demo/a/very/long/absolute/path/to/the/application'
		),
	],
	[
		'a2',
		{
			tool_name: 'Write',
			tool_input: {
				file_path: '/work/app/notes.txt',
				content: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'),
			},
			cwd: '/work/app',
			permission_suggestions: [],
		},
	],
	[
		'a1',
		{
			tool_name: 'Edit',
			tool_input: {
				file_path: '/work/app/src/app.js',
				old_string: 'const total = 1',
				new_string: 'const total = 2',
			},
			cwd: '/work/app',
		},
	],
	['merge', { tool_name: 'WebFetch', tool_input: { url: 'http://127.0.0.1:9911/', prompt: 'x' }, cwd: '/work/app' }],
	['a2', bash('npm view left-pad')],
] as const

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`permission requests line up at 1440, 900, and 400 in the ${colorScheme} theme`,
		{ ...browserTest, timeout: 120_000 },
		async (t) => {
			const { page, url, workspace, ui } = await open(t)
			asked.forEach(([who, body]) => void asking(ui, workspace, 'x-14', who, body))
			await waitOpen(workspace, asked.length)
			seedHistory(workspace, 'x-14', 'a1', ['echo one'])
			seedHistory(workspace, 'x-14', 'a1', ['echo two'], 'dawid', 'allow-tool')
			assert.equal(openOf(workspace)[0].id, 'P1')
			const paths = [
				'/plans/login?view=needs&focus=list',
				'/explorations/x-14',
				'/explorations/x-14?requests=1',
				'/permissions/x-14/P1',
				'/permissions/x-14/P2',
				'/permissions/x-14/P3',
				'/permissions/x-14/P4',
				'/permissions/x-14/P5',
				'/permissions/x-14/P6?view=history',
			]
			for (const width of [1440, 900, 400])
				for (const path of paths) await check(page, url(path), width, colorScheme)
		}
	)

test(
	'options 1 and 2 of a long command are fully visible at 1440 by 900, and the folder breaks at slashes',
	browserTest,
	async (t) => {
		const { page, url, workspace, ui } = await open(t, { viewport: { width: 1440, height: 900 } })
		void asking(ui, workspace, 'x-14', 'a1', asked[0][1])
		await waitOpen(workspace, 1)
		await page.goto(url('/permissions/x-14/P1'))
		await page.evaluate(() => document.fonts.ready)
		const placed = await page.evaluate(() => {
			const bottom = (index: number) => {
				const item = document.querySelectorAll('.sp-optlist li')[index].getBoundingClientRect()
				return item.bottom
			}
			return {
				first: bottom(0),
				second: bottom(1),
				room: document.querySelector('.statusbar')!.getBoundingClientRect().top,
			}
		})
		assert(
			placed.second <= placed.room,
			`option 2 ends at ${placed.second}, the status bar starts at ${placed.room}`
		)
		assert((await page.locator('.sp-ask-title').innerText()).length < 60)
		const details = await page.evaluate(() => {
			const folder = document.querySelector('dd.path')!.getBoundingClientRect()
			const label = document.querySelector('.facts dt')!.getBoundingClientRect()
			return { lines: Math.round(folder.height / 20), sameRow: Math.abs(folder.top - label.top) < 24 }
		})
		assert(details.lines <= 3, `the folder takes ${details.lines} lines`)
	}
)

function seedRequests(workspace: string) {
	const reading = openStore(workspace)
	try {
		const context = { planId: 'coupons', record: { kind: 'defect', id: 'k1/D1' } }
		const long = 'checkout/'.repeat(30)
		const running = askRequest(reading, 'qa-lead', { text: `why does D3 fail? ${long}`, context })
		setRequestState(reading, running, 'running')
		for (const line of ['Read: src/checkout/total.ts', `Bash: node ${long}${long}`, 'Grep: express fee'])
			addRequestActivity(reading, running, line)
		const answered = askRequest(reading, 'qa-lead', {
			text: 'hand over all high defects\nto the cart team',
			context,
		})
		setRequestState(reading, answered, 'answered', {
			reply: `Handed over 2 defects to the cart team. ${long}\n\n- k1/D1 (high)\n- k1/D2 (high)\n\nD9 stays, it is medium.`,
			costUsd: 0.31,
			denials: ['Bash: rm -rf build', `Write: ${long}`],
			changes: [
				{
					text: 'handed over coupons/k1/D1, coupons/k1/D2',
					command: 'claim handoff',
					subject: 'coupons',
					at: '2026-11-18T10:00:00.000Z',
					href: '/plans/coupons',
				},
				{
					text: 'answered coupons/Q4',
					command: 'gap answer',
					subject: 'coupons',
					at: '2026-11-18T10:00:01.000Z',
					href: '/plans/coupons',
				},
			],
		})
		const failed = askRequest(reading, 'qa-lead', { text: 'explain D10', context: { planId: null, record: null } })
		setRequestState(reading, failed, 'failed', {
			reason: [
				'claude ended without a reply.',
				...Array.from({ length: 20 }, (_, i) => `stack line ${i + 1} ${long}`),
			].join('\n'),
		})
		const unread = askRequest(reading, 'qa-lead', { text: 'and D4?', context })
		setRequestState(reading, unread, 'answered', { reply: 'D4 passes.', costUsd: 0.04, changes: [] })
		recordRequestEvent(
			reading,
			running,
			{ step: 'session', status: 'started', detail: { sessionId: 's' } },
			{ subjects: [] }
		)
	} finally {
		closeStore(reading)
	}
}

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`the request page and the replies list line up at 1440, 900, and 400 in the ${colorScheme} theme`,
		{ ...browserTest, timeout: 120_000 },
		async (t) => {
			const { page, url, workspace } = await open(t)
			seedRequests(workspace)
			const paths = ['/requests', '/requests/R1', '/requests/R2', '/requests/R3', '/requests', '/activity']
			for (const width of [1440, 900, 400])
				for (const path of paths) await check(page, url(path), width, colorScheme)
		}
	)

const widths = [1440, 1240, 1100, 900, 760, 600, 400]

test('no row moves when the highlight moves through 20 rows, at every width', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const width of widths) {
		await page.setViewportSize({ width, height: 900 })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		const boxes = () =>
			page.evaluate(() => {
				const list = document.querySelector('[data-panel]:not([hidden]) .sp-list')!.getBoundingClientRect()
				return [...document.querySelectorAll('[data-panel]:not([hidden]) [data-row]')].map((row) => {
					const box = row.getBoundingClientRect()
					return `${(box.top - list.top).toFixed(1)}:${box.height.toFixed(1)}`
				})
			})
		const first = await boxes()
		for (let step = 0; step < 20; step++) {
			await page.keyboard.press('ArrowDown')
			assert.deepEqual(await boxes(), first, `${width} px after ${step + 1} steps`)
		}
	}
})

test('the status bar buttons keep their place, and the hints fit, at every width', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const width of widths) {
		await page.setViewportSize({ width, height: 800 })
		const lefts: number[] = []
		for (const path of ['/', '/plans/coupons?view=needs&focus=list', '/plans/coupons?view=all&item=c%3Ak1%2FD1']) {
			await page.goto(url(path))
			await page.evaluate(() => document.fonts.ready)
			lefts.push(await page.locator('.sb-links').evaluate((links) => links.getBoundingClientRect().left))
			const clipped = await page.evaluate(() => {
				const keys = document.querySelector('[data-hints]')!.getBoundingClientRect()
				return [...document.querySelectorAll('.sb-k')]
					.filter((hint) => (hint as HTMLElement).offsetWidth)
					.some((hint) => hint.getBoundingClientRect().right > Math.min(keys.right, window.innerWidth) + 0.5)
			})
			assert.equal(clipped, false, `${path} at ${width}`)
			assert.equal(await page.locator('.sb-k[data-cap="?"]').isVisible(), true, `${path} at ${width}`)
			assert.match((await page.locator('[data-region="nav-count"]').textContent()) ?? '', /all plans/)
		}
		assert.equal(new Set(lefts.map((left) => left.toFixed(1))).size, 1, `${width}: ${lefts.join(', ')}`)
	}
})

test('the options of the highlighted row stay inside the row with the fallback font', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.route('**/assets/fonts/*.woff2', (route) => route.abort())
	for (const width of [1440, 1100, 760, 400])
		for (const path of [pages[1], pages[2], pages[5]]) await check(page, url(path), width, 'dark')
})

function covered() {
	const docked = ['[data-bulk]:not([hidden])', '[data-say-strip]:not([hidden])', '.toast']
		.map((selector) => document.querySelector(selector))
		.filter((element): element is HTMLElement => Boolean(element) && (element as HTMLElement).offsetHeight > 0)
		.map((element) => element.getBoundingClientRect())
	const hits = (element: Element) => {
		const box = element.getBoundingClientRect()
		if (!box.height) return false
		return docked.some(
			(dock) =>
				Math.min(box.bottom, dock.bottom) - Math.max(box.top, dock.top) > 0.5 &&
				Math.min(box.right, dock.right) - Math.max(box.left, dock.left) > 0.5
		)
	}
	const problems: string[] = []
	if (docked.length === 0) problems.push('nothing is docked')
	const highlighted = document.querySelector('.hl[data-row]')
	if (highlighted && hits(highlighted)) problems.push(`highlight ${highlighted.getAttribute('data-key')}`)
	const parts = document.querySelectorAll('[data-nav], [data-panel]:not([hidden]) :is([data-row], .sp-gh)')
	for (const part of parts) {
		part.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		if (hits(part))
			problems.push(
				`${part.getAttribute('data-key') ?? part.getAttribute('data-target') ?? part.textContent?.trim()}`
			)
	}
	return problems
}

const docks = [
	[1440, 900],
	[1440, 500],
	[900, 700],
	[760, 700],
	[400, 700],
] as const

test('the selection strip covers no part of either pane, at every size', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const [width, height] of docks) {
		await page.setViewportSize({ width, height })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.keyboard.press('Space')
		await page.locator('[data-bulk]:not([hidden])').waitFor()
		const rows = await page.locator('[data-panel="all"] [data-row]').count()
		for (let step = 0; step < rows; step++) {
			await page.keyboard.press('ArrowDown')
			assert.deepEqual(await page.evaluate(covered), [], `${width}x${height} step ${step}`)
		}
	}
})

test('the toast covers no part of either pane, at every size', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const [width, height] of docks) {
		await page.setViewportSize({ width, height })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.evaluate(() => {
			const note = document.createElement('div')
			note.className = 'toast'
			note.setAttribute('role', 'status')
			note.textContent = 'Accepted coupons · k1/D10'
			document.body.append(note)
			window.dispatchEvent(new Event('resize'))
		})
		const rows = await page.locator('[data-panel="all"] [data-row]').count()
		for (let step = 0; step < rows; step++) {
			await page.keyboard.press('ArrowDown')
			assert.deepEqual(await page.evaluate(covered), [], `${width}x${height} step ${step}`)
		}
	}
})

test('a status message is read in full at every width, and the key hints make room for it', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const items: Array<[number, string, string]> = [
		[1440, 'c', 'k1/D10'],
		[1240, 'c', 'k1/D12'],
		[1100, 'q', 'k1/Q3'],
		[900, 'q', 'k1/Q4'],
		[760, 'q', 'k1/Q6'],
		[600, 'q', 'k1/Q7'],
		[400, 'q', 'k1/Q8'],
	]
	for (const [width, kind, id] of items) {
		await page.setViewportSize({ width, height: 700 })
		await page.goto(url(`/plans/coupons?view=needs&focus=list&at=${kind}%3A${encodeURIComponent(id)}`))
		await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
		await page.waitForFunction((key) => document.activeElement?.getAttribute('data-key') === key, `${kind}:${id}`)
		read(workspace, (store) =>
			kind === 'c'
				? decideClaim(store, 'qa-lead', {
						planId: 'coupons',
						claimId: id,
						verdict: 'approved',
						rationale: 'Elsewhere.',
					})
				: answerGap(store, 'qa-lead', {
						planId: 'coupons',
						gapId: id,
						kind: 'defer',
						value: 'Later.',
						rationale: 'Elsewhere.',
					})
		)
		await page.waitForFunction(
			(key) =>
				document.activeElement?.matches('[data-row]') &&
				document.activeElement.getAttribute('data-key') !== key,
			`${kind}:${id}`
		)
		await page.keyboard.press('1')
		const message = await page.evaluate(() => {
			const say = document.querySelector('[data-say]') as HTMLElement
			const strip = document.querySelector('[data-say-strip]') as HTMLElement
			const shown = [say, strip].find(
				(element) => !element.hidden && element.offsetWidth > 0 && element.textContent
			)
			const hints = document.querySelector('[data-hints]') as HTMLElement
			return {
				text: shown?.textContent ?? '',
				clipped: shown
					? shown.scrollWidth > shown.clientWidth + 0.5 || shown.scrollHeight > shown.clientHeight + 0.5
					: true,
				hintsClipped: hints.scrollWidth > hints.clientWidth + 0.5,
				keys: Boolean(hints.querySelector('[data-cap="?"]:not([hidden])')),
			}
		})
		assert.match(
			message.text,
			new RegExp(`^Nothing is recorded\\. ${id} was (decided|answered) in another session\\.`),
			`${width}`
		)
		assert.equal(message.clipped, false, `${width}: the message is cut`)
		assert.equal(message.hintsClipped, false, `${width}: a hint is cut`)
		assert.equal(message.keys, true, `${width}: ? Keys is gone`)
		assert.deepEqual(await page.evaluate(covered), [], `${width}: the message covers the panes`)
	}
})

for (const path of ['/activity', '/explorations/x-14']) {
	test(`no row of ${path} moves when the highlight moves, at every width`, browserTest, async (t) => {
		const { page, url } = await open(t)
		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 })
			await page.goto(url(path))
			await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
			const boxes = () =>
				page.evaluate(() => {
					const list = document.querySelector('[data-list]')!.getBoundingClientRect()
					return [...document.querySelectorAll('[data-list] [data-row]')].map((row) => {
						const box = row.getBoundingClientRect()
						return `${(box.top - list.top).toFixed(1)}:${box.height.toFixed(1)}`
					})
				})
			const first = await boxes()
			const rows = first.length
			for (let step = 0; step < rows + 1; step++) {
				await page.keyboard.press('ArrowDown')
				assert.deepEqual(await boxes(), first, `${path} at ${width} after ${step + 1} steps`)
			}
		}
	})
}

test(
	'a row whose options do not all fit shows the number of options and no sideways scroll',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		for (const width of [1440, 900, 400]) {
			await page.setViewportSize({ width, height: 900 })
			await page.goto(url('/activity'))
			await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
			await page.evaluate(() => {
				for (const label of document.querySelectorAll('.sp-c-opts .sp-btn > span'))
					label.textContent += ' with a very long label'.repeat(60)
				window.dispatchEvent(new Event('resize'))
			})
			for (let step = 0; step < 12 && !(await page.locator('.hl[data-row] [data-option]').count()); step++)
				await page.keyboard.press('ArrowDown')
			const shown = await page.evaluate(() => {
				const row = document.querySelector('.hl[data-row]') as HTMLElement
				const more = row.querySelector('.sp-c-more') as HTMLElement
				const buttons = [...row.querySelectorAll('[data-option]')].filter(
					(button) => (button as HTMLElement).offsetWidth > 0
				)
				return {
					many: row.classList.contains('many'),
					more: more.offsetWidth > 0 ? more.textContent!.replace(/\s+/g, ' ').trim() : null,
					buttons: buttons.length,
					overflow: row.scrollWidth > row.clientWidth + 1,
					page: document.documentElement.scrollWidth > window.innerWidth,
					inside: more.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.5,
				}
			})
			assert.deepEqual(
				shown,
				{ many: true, more: '1 option', buttons: 0, overflow: false, page: false, inside: true },
				`${width}`
			)
			await page.keyboard.press('1')
			await page.waitForFunction(() =>
				[...document.querySelectorAll('[data-say], [data-say-strip]')].some((element) =>
					/Open the row to see them/.test(element.textContent ?? '')
				)
			)
			assert.equal(await page.locator('dialog[open]').count(), 0)
		}
	}
)

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`the action dialogs line up and meet the contrast and tap rules in the ${colorScheme} theme`,
		browserTest,
		async (t) => {
			const { page, url } = await open(t)
			const dialogs: Array<[string, string]> = [
				['/plans/coupons', '[data-panel]:not([hidden]) [data-act="test"]'],
				['/plans/search', '[data-panel]:not([hidden]) [data-act="follow"]'],
				['/explorations/x-14', '[data-act="stop-x-14"]'],
			]
			for (const width of [1440, 900, 400])
				for (const [path, opener] of dialogs) {
					await page.setViewportSize({ width, height: 900 })
					await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
					await page.goto(url(path))
					await page.evaluate(() => document.fonts.ready)
					await page.locator(opener).first().click()
					await page.locator('dialog[open]').waitFor()
					const problems = await page.evaluate(measure, width <= 760)
					assert.deepEqual(problems, [], `${path} dialog at ${width} in ${colorScheme}`)
					const box = await page.locator('dialog[open]').boundingBox()
					assert(box && box.x >= 0 && box.x + box.width <= width + 0.5, `${path} dialog fits ${width}`)
				}
		}
	)

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`the first-run form with its assumptions lines up at 1440, 900, and 400 in the ${colorScheme} theme`,
		browserTest,
		async (t) => {
			const { page, url } = await open(t)
			for (const width of [1440, 900, 400])
				for (const address of ['http://localhost:3000', 'http://shop.example.com']) {
					await page.setViewportSize({ width, height: 900 })
					await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
					await page.goto(url('/setup'))
					await page.evaluate(() => document.fonts.ready)
					await page.locator('#setup-url').fill(address)
					await page.locator('[data-assumed]:not([hidden]) [data-assumed-list] dt').first().waitFor()
					const problems = await page.evaluate(measure, width <= 760)
					assert.deepEqual(problems, [], `${address} at ${width} in ${colorScheme}`)
				}
		}
	)

test(
	'messages show in the case that was written, and the labels of buttons stay in capitals',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		const cases = await page.evaluate(() => {
			const say = document.querySelector('[data-say]') as HTMLElement
			const toast = document.createElement('div')
			toast.className = 'toast'
			toast.textContent = 'Started x-19 on build b-normal'
			document.body.append(toast)
			const button = document.querySelector('.sb-btn') as HTMLElement
			return [say, toast, button].map((element) => getComputedStyle(element).textTransform)
		})
		assert.deepEqual(cases, ['none', 'none', 'uppercase'])
	}
)
