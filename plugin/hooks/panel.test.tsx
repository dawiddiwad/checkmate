import { expect, test } from 'claude-code/testing'

const pane = {
	plugin: 'checkmate',
	component: 'Pane',
	requestId: 'checkmate',
	props: {
		title: 'Checkmate',
		isFocused: false,
		bodyColumns: 60,
		placement: 'dock',
		scroll: { offset: 0, bodyRows: 30 },
		view: {},
	},
} as const

const inbox = {
	status: 'completed',
	reasons: [],
	gaps: [
		{
			planId: 'SHOP-1',
			revision: 2,
			gapId: 'G1',
			question: 'Does the coupon apply to shipping?',
			severity: 'blocking',
			runId: null,
			explorationId: null,
		},
	],
	plans: [{ planId: 'SHOP-1', revision: 2, approval: 'pending', summary: '3 tests: 2 ready, 1 blocked' }],
	results: [
		{
			runId: 'run-7',
			planId: 'SHOP-1',
			revision: 2,
			build: 'abc123',
			counts: { passed: 2, failed: 1 },
			coverage: 'full',
		},
	],
	claims: [],
	requests: [],
}

const plans = {
	status: 'completed',
	reasons: [],
	plans: [
		{
			planId: 'SHOP-1',
			revision: 2,
			openGaps: ['G1'],
			tests: { total: 3, ready: 2, blocked: 1 },
			loop: { state: 'needs_decision', waitsOn: 'oracle' },
		},
	],
}

function ran(reply: unknown) {
	return {
		value: {
			exitCode: 0,
			stdout: JSON.stringify(reply),
			stderr: '',
			isStdoutTruncated: false,
			isStderrTruncated: false,
		},
	}
}

const opened = {
	command: 'checkmate-panel',
	args: '',
	origin: { kind: 'composer' },
	presentation: { isFullscreen: true, columns: 120 },
} as const

const surfaces = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('the pane shows the inbox and the plan status of the record', async ($, on) => {
	const commands: string[][] = []
	on('command.register', () => ({ value: { command: 'checkmate-panel' } }))
	on('ui.open', () => ({ value: { isPlaced: true } }))
	on('ui.status', () => ({ value: undefined }))
	on('session.cwd', () => ({ value: '/shop' }))
	on('fs.stat', (_, e) => {
		expect(e.path).toBe('/shop/.checkmate/checkmate.db')
		return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
	})
	on('process.run', (_, e) => {
		commands.push([...e.argv])
		return ran(e.argv.includes('inbox') ? inbox : plans)
	})

	await $.command.run(opened)

	expect(commands.map((argv) => argv.slice(2))).toEqual([
		['inbox', '--json'],
		['plan', 'list', '--json'],
	])
	for (const surface of surfaces) {
		const ui = await $.ui.mount({ ...pane, surface })
		expect((await ui.find({ type: 'Text', text: /Waiting for a decision/ }))?.text).toBe(
			'Waiting for a decision (3)'
		)
		expect(await ui.find({ type: 'Text', text: /Does the coupon apply to shipping\?/ })).toBeTruthy()
		expect(await ui.find({ type: 'Text', text: /result run-7/ })).toBeTruthy()
		expect(await ui.find({ type: 'Text', text: /coverage full, 2 passed, 1 failed/ })).toBeTruthy()
		expect(await ui.find({ type: 'Text', text: /SHOP-1 needs decision/ })).toBeTruthy()
		expect(await ui.find({ type: 'Text', text: /waits on oracle/ })).toBeTruthy()
		await ui.unmount()
	}
})

test('a folder with no record starts no command and creates no record', async ($, on) => {
	let runs = 0
	on('command.register', () => ({ value: { command: 'checkmate-panel' } }))
	on('ui.open', () => ({ value: { isPlaced: true } }))
	on('ui.status', () => ({ value: undefined }))
	on('session.cwd', () => ({ value: '/empty' }))
	on('fs.stat', () => {
		throw Error('fs.stat failed: ENOENT')
	})
	on('process.run', () => {
		runs += 1
		return ran(inbox)
	})

	await $.command.run(opened)

	const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
	expect(await ui.find({ type: 'Text', text: /No Checkmate record in this folder/ })).toBeTruthy()
	expect(runs).toBe(0)
	await ui.unmount()
})

test('a refused read shows the reason', async ($, on) => {
	on('command.register', () => ({ value: { command: 'checkmate-panel' } }))
	on('ui.open', () => ({ value: { isPlaced: true } }))
	on('ui.status', () => ({ value: undefined }))
	on('session.cwd', () => ({ value: '/shop' }))
	on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
	on('process.run', () => ran({ status: 'rejected', reasons: ['The workspace database is older.'] }))

	await $.command.run(opened)

	const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
	expect(await ui.find({ type: 'Text', text: /The workspace database is older\./ })).toBeTruthy()
	await ui.unmount()
})
