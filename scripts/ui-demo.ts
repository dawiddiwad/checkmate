import type { PlanCandidate, PlanRequest, Profile } from '../plugin/src/types.ts'
import type { Store } from '../plugin/src/store.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import {
	acceptResult,
	addInstance,
	answerGap,
	approvePlan,
	beginRun,
	checkAssertion,
	closeStore,
	closeTest,
	editPlan,
	finishRun,
	openPlan,
	openStore,
	openTarget,
	planCandidate,
	planDetail,
	recordFinding,
	recordGap,
	retireInstance,
	revisePlan,
	savePlan,
	saveTarget,
} from '../plugin/src/index.ts'
import { openExploration } from '../plugin/src/explorations.ts'
import { done, ended, event, launch, launched } from '../test/explorations.ts'

export const human = 'qa-lead'
export const agent = 'checkmate-agent'

const RealDate = Date
let offsetMinutes = 0

class DemoDate extends RealDate {
	constructor(...args: unknown[]) {
		if (args.length) super(...(args as [string]))
		else super(RealDate.now() - offsetMinutes * 60_000)
	}
	static now() {
		return RealDate.now() - offsetMinutes * 60_000
	}
}

export function minutesAgo(minutes: number) {
	offsetMinutes = minutes
}

export function withDemoClock(run: () => void) {
	globalThis.Date = DemoDate as DateConstructor
	try {
		run()
	} finally {
		globalThis.Date = RealDate
	}
}

export function profile(): Profile {
	return {
		contractVersion: 'toolkit-2',
		targetId: 'shop-local',
		revision: 1,
		entryPoints: [{ name: 'web', kind: 'url', purpose: 'Shop web application and HTTP API.' }],
		capabilities: ['browser', 'http'],
		tools: [
			{
				name: 'playwright-cli',
				kind: 'cli',
				purpose: 'Drive the browser.',
				version: '0.1.23',
				reachable: true,
			},
			{ name: 'node', kind: 'cli', purpose: 'Send HTTP requests.', version: '24.12.0', reachable: true },
		],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['sign_in', 'read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		startup: { owner: 'factory', command: null },
		cleanup: 'Close the run browser session. The fixture stores no records.',
		readyForLiveExecution: true,
		reset: { owner: 'environment', command: null, policy: { text: 'The test fixture keeps no records.' } },
		approvals: { plan: 'required', result: 'required' },
	}
}

const loginRequest: PlanRequest = {
	objective: 'Verify sign-in and the account lockout for customer accounts.',
	requirements: [
		{ id: 'L1', text: 'A customer with a valid password can sign in.', source: 'brief://accounts#sign-in' },
		{ id: 'L2', text: 'Five failed attempts lock the account for 15 minutes.', source: 'brief://accounts#lockout' },
	],
	sourceContext: [{ uri: 'brief://accounts', content: 'Sign-in uses email and password. Lockout after 5 failures.' }],
}

const loginCandidate: PlanCandidate = {
	tests: [
		{
			id: 'T1',
			title: 'Sign in with a valid password',
			requirementIds: ['L1'],
			capability: 'browser',
			operations: ['sign_in'],
			dependsOn: [],
			preconditions: ['Fixture customer anna@example.test exists.'],
			action: 'Open the sign-in page, enter valid credentials, and submit.',
			assertions: [
				{ id: 'A1', check: 'The account page shows the customer name.', checkKind: 'agent_observation' },
				{
					id: 'A2',
					check: 'The session cookie has the HttpOnly flag.',
					checkKind: 'deterministic',
					observe: 'the Set-Cookie attributes of the session cookie',
					expected: 'HttpOnly',
				},
			],
		},
		{
			id: 'T2',
			title: 'Lockout after five failures',
			requirementIds: ['L2'],
			capability: 'http',
			operations: ['sign_in'],
			dependsOn: [],
			preconditions: ['Fixture customer ben@example.test has no failed attempts.'],
			action: 'Send six sign-in requests with a wrong password.',
			assertions: [
				{
					id: 'A1',
					check: 'The sixth attempt returns HTTP 423.',
					checkKind: 'deterministic',
					observe: 'the HTTP status of the sixth attempt',
					expected: '423',
				},
				{ id: 'A2', check: 'The response names the unlock time.', checkKind: 'agent_observation' },
				{
					id: 'A3',
					check: 'A sign-in with the right password for another fixture customer returns HTTP 200.',
					checkKind: 'deterministic',
					observe: 'the HTTP status of that sign-in',
					expected: '200',
				},
			],
		},
	],
	gaps: [],
}

const checkoutRequest: PlanRequest = {
	objective: 'Verify checkout totals, the spring promotion, and refund eligibility.',
	requirements: [
		{
			id: 'R1',
			text: 'A standard order for a 400 PLN item has a total of 400 PLN.',
			source: 'brief://checkout#total',
		},
		{
			id: 'R2',
			text: 'The 40 percent spring promotion applies to the cart total.',
			source: 'brief://checkout#spring',
			metadata: { jira: 'SHOP-41' },
		},
		{ id: 'R3', text: 'Customers can refund eligible orders.', source: 'brief://checkout#refunds' },
		{ id: 'R4', text: 'The checkout page announces the promotion.', source: 'brief://checkout#banner' },
	],
	sourceContext: [{ uri: 'brief://checkout', content: 'One item at 400 PLN. SPRING40 gives 40 percent.' }],
}

const checkoutCandidate: PlanCandidate = {
	tests: [
		{
			id: 'T1',
			title: 'Standard order total',
			requirementIds: ['R1'],
			capability: 'browser',
			operations: ['create_fixture_order'],
			dependsOn: ['login:T1'],
			preconditions: ['Signed-in customer with an empty cart.'],
			action: 'Add the 400 PLN item, complete checkout, and read the confirmation.',
			assertions: [
				{ id: 'A1', check: 'The confirmation shows a total of 400 PLN.', checkKind: 'agent_observation' },
				{
					id: 'A2',
					check: 'The order API returns one line item.',
					checkKind: 'deterministic',
					observe: 'the number of line items in the order API response',
					expected: '1',
				},
			],
		},
		{
			id: 'T2',
			title: 'Promotion replaces loyalty',
			requirementIds: ['R2'],
			capability: 'http',
			operations: ['apply_fixture_discount'],
			dependsOn: ['T1'],
			preconditions: ['Cart with one 400 PLN item and a 20 PLN loyalty credit.'],
			action: 'Apply the code SPRING40 and read the quote.',
			metadata: { priority: 'high', component: 'pricing', xrayKey: 'SHOP-T7' },
			assertions: [
				{
					id: 'A1',
					check: 'The response status is HTTP 200.',
					checkKind: 'deterministic',
					observe: 'the HTTP status of the quote',
					expected: '200',
				},
				{
					id: 'A2',
					check: 'totalPLN equals 220.',
					checkKind: 'deterministic',
					observe: 'totalPLN in the quote',
					expected: '220',
				},
				{
					id: 'A3',
					check: 'The quote does not list the loyalty discount.',
					checkKind: 'deterministic',
					observe: 'the discount lines in the quote',
					expected: 'none',
				},
			],
		},
		{
			id: 'T3',
			title: 'Refund eligibility',
			requirementIds: ['R3'],
			capability: 'http',
			operations: ['read_catalog'],
			dependsOn: [],
			preconditions: ['A delivered fixture order.'],
			action: 'Request a refund for the delivered order.',
			assertions: [],
		},
		{
			id: 'T4',
			title: 'Promotion banner',
			requirementIds: ['R4'],
			capability: 'browser',
			operations: ['read_catalog'],
			dependsOn: [],
			preconditions: ['Cart with one item.'],
			action: 'Open the checkout page and read the banner.',
			assertions: [
				{ id: 'A1', check: 'The checkout page shows a promotion banner.', checkKind: 'agent_observation' },
				{ id: 'A2', check: 'The banner states a 40 percent discount.', checkKind: 'agent_observation' },
			],
		},
	],
	gaps: [
		{
			id: 'G1',
			severity: 'blocking',
			status: 'open',
			requirementIds: ['R2'],
			testIds: ['T2'],
			question: 'Does the spring promotion stack with the loyalty credit?',
			consequence: 'The expected quote total is unknown.',
			decisionId: null,
		},
		{
			id: 'G2',
			severity: 'blocking',
			status: 'open',
			requirementIds: ['R3'],
			testIds: ['T3'],
			question: 'Which orders can a customer refund, and for how many days after delivery?',
			consequence: 'Refund eligibility cannot be asserted.',
			decisionId: null,
		},
		{
			id: 'G3',
			severity: 'non_blocking',
			status: 'open',
			requirementIds: ['R4'],
			testIds: ['T4'],
			question: 'Must the banner show on screens narrower than 400 px?',
			consequence: 'The narrow layout is not checked.',
			decisionId: null,
		},
	],
}

const searchRequest: PlanRequest = {
	objective: 'Verify catalog search ranking and the empty result.',
	requirements: [
		{ id: 'S1', text: 'A search for "lamp" lists lamps first.', source: 'brief://search#ranking' },
		{ id: 'S2', text: 'An unknown term shows a helpful empty state.', source: 'brief://search#empty' },
	],
	sourceContext: [{ uri: 'brief://search', content: 'Search ranks by title match, then popularity.' }],
}

const searchCandidate: PlanCandidate = {
	tests: [
		{
			id: 'T1',
			title: 'Lamps rank first',
			requirementIds: ['S1'],
			capability: 'browser',
			operations: ['read_catalog'],
			dependsOn: [],
			preconditions: ['The fixture catalog is loaded.'],
			action: 'Search for "lamp" and read the first five results.',
			assertions: [
				{ id: 'A1', check: 'The first three results are lamps.', checkKind: 'agent_observation' },
				{
					id: 'A2',
					check: 'The result count is 12.',
					checkKind: 'deterministic',
					observe: 'the result count',
					expected: '12',
				},
			],
		},
		{
			id: 'T2',
			title: 'Empty state for an unknown term',
			requirementIds: ['S2'],
			capability: 'browser',
			operations: ['read_catalog'],
			dependsOn: [],
			preconditions: [],
			action: 'Search for "zzqx".',
			assertions: [
				{
					id: 'A1',
					check: 'The page says that nothing matches and offers popular items.',
					checkKind: 'agent_observation',
				},
			],
		},
	],
	gaps: [],
}

export function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number]) {
	const rows = Buffer.alloc((width * 3 + 1) * height)
	for (let y = 0; y < height; y++) {
		rows[y * (width * 3 + 1)] = 0
		for (let x = 0; x < width; x++) {
			const offset = y * (width * 3 + 1) + 1 + x * 3
			const [r, g, b] = paint(x, y)
			rows[offset] = r
			rows[offset + 1] = g
			rows[offset + 2] = b
		}
	}
	const chunk = (type: string, data: Buffer) => {
		const length = Buffer.alloc(4)
		length.writeUInt32BE(data.length)
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
		const crc = Buffer.alloc(4)
		crc.writeUInt32BE(crc32(body))
		return Buffer.concat([length, body, crc])
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, 2, 0, 0, 0], 8)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(rows)),
		chunk('IEND', Buffer.alloc(0)),
	])
}

function inside(x: number, y: number, box: [number, number, number, number]) {
	return x >= box[0] && y >= box[1] && x < box[0] + box[2] && y < box[1] + box[3]
}

export function pageShot(variant: 'confirmation' | 'banner' | 'account') {
	return png(480, 300, (x, y) => {
		if (y < 36) return [27, 36, 32]
		if (inside(x, y, [24, 12, 60, 12])) return [227, 235, 231]
		if (variant === 'banner' && inside(x, y, [24, 56, 432, 44])) {
			if (inside(x, y, [40, 70, 150, 16])) return [255, 255, 255]
			return [44, 97, 80]
		}
		if (variant === 'confirmation' && inside(x, y, [24, 60, 432, 120])) {
			if (inside(x, y, [44, 84, 180, 14]) || inside(x, y, [44, 112, 120, 22])) return [27, 36, 32]
			if (inside(x, y, [44, 150, 260, 8])) return [190, 200, 195]
			return [227, 239, 234]
		}
		if (variant === 'account' && inside(x, y, [24, 60, 200, 18])) return [27, 36, 32]
		for (let row = 0; row < 4; row++)
			if (inside(x, y, [24, 200 + row * 22, 432 - row * 70, 10])) return [221, 227, 223]
		return [246, 247, 245]
	})
}

function evidence(store: Store, runId: string, name: string, content: string | Buffer) {
	const directory = join(store.workspace, '.checkmate', 'tmp', runId)
	mkdirSync(directory, { recursive: true })
	writeFileSync(join(directory, name), content)
	return `.checkmate/tmp/${runId}/${name}`
}

function check(
	store: Store,
	runId: string,
	reference: string,
	result: 'passed' | 'failed' | 'inconclusive' | undefined,
	observed: string,
	file: [string, string | Buffer],
	reason?: string
) {
	const [testId, assertionId] = reference.split('.')
	return checkAssertion(store, agent, {
		runId,
		testId,
		assertionId,
		result,
		observed,
		reason,
		evidence: [evidence(store, runId, file[0], file[1])],
	})
}

function json(value: unknown) {
	return JSON.stringify(value, null, 2) + '\n'
}

function seedLogin(store: Store) {
	minutesAgo(4320)
	openPlan(store, agent, { planId: 'login', target: 'shop-local@1', request: loginRequest })
	savePlan(store, agent, { planId: 'login', candidate: loginCandidate })
	minutesAgo(4200)
	approvePlan(store, human, { reference: 'login@1', rationale: 'Both requirements have deterministic checks.' })
}

function seedLoginRun(store: Store) {
	minutesAgo(190)
	beginRun(store, agent, {
		runId: 'run-3',
		reference: 'login@1',
		tests: ['T1', 'T2'],
		build: 'fixture-build-2',
		instance: 'local',
	})
	check(store, 'run-3', 'T1.A1', 'passed', 'Account page shows "Anna Nowak".', [
		'T1-account.png',
		pageShot('account'),
	])
	check(store, 'run-3', 'T1.A2', undefined, 'HttpOnly', [
		'T1-cookie.txt',
		'Set-Cookie: sid=redacted; Path=/; HttpOnly; SameSite=Lax\n',
	])
	closeTest(store, agent, { runId: 'run-3', testId: 'T1' })
	check(store, 'run-3', 'T2.A1', undefined, '423', [
		'T2-lockout.json',
		json({ request: { attempt: 6 }, response: { status: 423 } }),
	])
	check(store, 'run-3', 'T2.A2', 'passed', 'Body says "Try again at 14:41."', [
		'T2-lockout-body.txt',
		'Your account is locked. Try again at 14:41.\n',
	])
	check(store, 'run-3', 'T2.A3', undefined, '200', [
		'T2-control.json',
		json({ request: { customer: 'other@example.test' }, response: { status: 200 } }),
	])
	closeTest(store, agent, { runId: 'run-3', testId: 'T2' })
	minutesAgo(180)
	finishRun(store, agent, {
		runId: 'run-3',
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Closed the run browser session.',
	})
	minutesAgo(170)
	acceptResult(store, human, { runId: 'run-3', rationale: 'All checks passed with evidence.' })
}

function seedCheckout(store: Store) {
	minutesAgo(1560)
	openPlan(store, agent, { planId: 'checkout', target: 'shop-local@1', request: checkoutRequest })
	savePlan(store, agent, { planId: 'checkout', candidate: checkoutCandidate })
	minutesAgo(210)
	answerGap(store, human, {
		planId: 'checkout',
		gapId: 'G1',
		kind: 'clarify',
		value: 'The promotion replaces the loyalty credit. The expected total is 240 PLN.',
		source: 'oracle://pricing-decisions#spring40',
		rationale: 'Confirmed by the pricing owner on 10 November.',
	})
	answerGap(store, human, {
		planId: 'checkout',
		gapId: 'G3',
		kind: 'accept_assumption',
		value: 'The banner shows at all widths.',
		rationale: 'Same rule as the other promotions.',
	})
}

function seedRevision(store: Store) {
	minutesAgo(125)
	revisePlan(store, agent, {
		planId: 'checkout',
		delta: {
			tests: {
				T2: {
					assertions: [
						{
							check: 'The response status is HTTP 200.',
							checkKind: 'deterministic',
							observe: 'the HTTP status of the quote',
							expected: '200',
						},
						{
							check: 'totalPLN equals 240.',
							checkKind: 'deterministic',
							observe: 'totalPLN in the quote',
							expected: '240',
						},
						{
							check: 'No loyalty line in the quote.',
							checkKind: 'deterministic',
							observe: 'the discount lines in the quote',
							expected: 'none',
						},
					],
				},
			},
		},
	})
	minutesAgo(110)
	approvePlan(store, human, {
		reference: 'checkout@2',
		rationale: 'G1 is clarified. T3 waits for the refund answer; run the ready tests.',
	})
}

function seedCheckoutRun(store: Store) {
	minutesAgo(40)
	beginRun(store, agent, {
		runId: 'run-7',
		reference: 'checkout@2',
		tests: ['T1', 'T2', 'T4'],
		build: 'fixture-build-2',
		instance: 'local',
		partial: 'ready_only',
	})
	check(store, 'run-7', 'T1.A1', 'passed', 'Confirmation shows "Total: 400.00 PLN".', [
		'T1-confirmation.png',
		pageShot('confirmation'),
	])
	check(store, 'run-7', 'T1.A2', undefined, '1', [
		'T1-order.json',
		json({ orderId: 'fx-1042', lineItems: [{ sku: 'LAMP-01', quantity: 1, pricePLN: 400 }], totalPLN: 400 }),
	])
	closeTest(store, agent, { runId: 'run-7', testId: 'T1' })
	minutesAgo(30)
	const quote = json({
		request: { method: 'POST', path: '/api/quote', body: { code: 'SPRING40' } },
		response: {
			status: 200,
			body: {
				subtotalPLN: 400,
				discounts: [{ code: 'SPRING40', amountPLN: 160 }],
				loyaltyPLN: 20,
				totalPLN: 220,
			},
		},
	})
	check(store, 'run-7', 'T2.A1', undefined, '200', ['T2-quote-status.json', quote])
	const failed = check(store, 'run-7', 'T2.A4', undefined, '220', ['T2-quote.json', quote])
	check(store, 'run-7', 'T2.A5', undefined, 'none', [
		'T2-quote-lines.txt',
		'Lines: SPRING40 −160 PLN\nNo loyalty line.\n',
	])
	recordFinding(store, agent, {
		runId: 'run-7',
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T2.A4'],
			requirementIds: ['R2'],
			title: 'The promotion stacks with the loyalty credit',
			expected: 'totalPLN is 240: the promotion replaces the loyalty credit.',
			observed: 'totalPLN is 220: the quote subtracts both the promotion and the 20 PLN credit.',
			reproduction: [
				'Sign in as anna@example.test.',
				'Add LAMP-01 (400 PLN) to the cart.',
				'Apply the code SPRING40.',
				'Read totalPLN in the quote response.',
			],
			evidenceIds: failed.data.evidenceIds as string[],
			metadata: { jiraKey: 'SHOP-142', component: 'pricing', regression: true },
		},
	})
	closeTest(store, agent, { runId: 'run-7', testId: 'T2' })
	minutesAgo(22)
	check(store, 'run-7', 'T4.A1', 'passed', 'Banner visible above the cart.', ['T4-banner.png', pageShot('banner')])
	check(
		store,
		'run-7',
		'T4.A2',
		'inconclusive',
		'Banner text is cut off at "Save 4…".',
		['T4-banner-crop.png', pageShot('banner')],
		'The screenshot does not show the full rate.'
	)
	recordGap(store, agent, {
		runId: 'run-7',
		gap: {
			id: 'G4',
			severity: 'non_blocking',
			status: 'open',
			requirementIds: ['R4'],
			testIds: ['T4'],
			question: 'Must the banner text wrap instead of being cut off?',
			consequence: 'T4.A2 cannot show the full rate on a narrow banner.',
			decisionId: null,
		},
	})
	closeTest(store, agent, { runId: 'run-7', testId: 'T4' })
	minutesAgo(14)
	finishRun(store, agent, {
		runId: 'run-7',
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Closed the run browser session. The fixture stores no records.',
	})
}

const accountRequest: PlanRequest = {
	objective: 'Verify that a customer can change the account profile.',
	requirements: [{ id: 'P1', text: 'A customer can change the display name.', source: 'brief://accounts#profile' }],
	sourceContext: [{ uri: 'brief://accounts', content: 'The profile page edits the display name.' }],
}

const accountCandidate: PlanCandidate = {
	tests: [
		{
			id: 'T1',
			title: 'Change the display name',
			requirementIds: ['P1'],
			capability: 'browser',
			operations: ['sign_in'],
			dependsOn: [],
			preconditions: ['Signed in as anna@example.test.'],
			action: 'Open the profile page and save a new display name.',
			assertions: [
				{
					id: 'A1',
					check: 'The header shows the new name.',
					checkKind: 'deterministic',
					observe: 'the name shown in the header after the save',
					expected: 'Anna Nowak',
				},
			],
		},
	],
	gaps: [],
}

const accountTitles = [
	'Change the display name',
	'Change the display name and reload',
	'Change the display name on the profile page',
	'Save a new display name',
	'Save a new display name and reload',
	'Save a new display name from the profile page',
	'Save a new display name and see it in the header',
]

function seedAccount(store: Store) {
	minutesAgo(3000)
	openPlan(store, agent, { planId: 'account', target: 'shop-local@1', request: accountRequest })
	savePlan(store, agent, { planId: 'account', candidate: accountCandidate })
	for (const [index, title] of accountTitles.slice(1).entries()) {
		const revision = index + 1
		minutesAgo(2900 - index * 100)
		approvePlan(store, human, { reference: `account@${revision}`, rationale: 'The check is clear.' })
		const candidate = planCandidate(planDetail(store, 'account').plan)
		candidate.tests[0].title = title
		editPlan(store, agent, { reference: `account@${revision}`, candidate })
	}
	approvePlan(store, human, { reference: `account@${accountTitles.length}`, rationale: 'The check is clear.' })
}

function seedSearch(store: Store) {
	minutesAgo(50)
	openPlan(store, agent, { planId: 'search', target: 'shop-local@1', request: searchRequest })
	savePlan(store, agent, { planId: 'search', candidate: searchCandidate })
}

function seedStartedRun(store: Store) {
	minutesAgo(5)
	beginRun(store, agent, {
		runId: 'run-8',
		reference: 'login@1',
		tests: ['T1', 'T2'],
		build: 'fixture-build-3',
		instance: 'staging',
	})
	minutesAgo(3)
	check(store, 'run-8', 'T1.A1', 'passed', 'Account page shows "Anna Nowak".', [
		'T1-account.png',
		pageShot('account'),
	])
}

export function seedDemo(workspace: string) {
	const store = openStore(workspace)
	try {
		withDemoClock(() => seedAll(store))
	} finally {
		closeStore(store)
	}
}

function seedAll(store: Store) {
	minutesAgo(5000)
	const value = profile()
	openTarget(store, agent, {
		targetId: value.targetId,
		entryPoints: value.entryPoints,
		capabilities: value.capabilities,
		allowedOperations: value.allowedOperations,
	})
	saveTarget(store, agent, { targetId: value.targetId, profile: value })
	addInstance(store, agent, {
		targetId: value.targetId,
		instanceId: 'preview',
		instance: { entries: { web: 'http://127.0.0.1:4100' }, environment: 'Old preview build' },
	})
	addInstance(store, agent, {
		targetId: value.targetId,
		instanceId: 'local',
		instance: { entries: { web: 'http://127.0.0.1:4173' }, environment: 'Local fixture' },
	})
	addInstance(store, agent, {
		targetId: value.targetId,
		instanceId: 'staging',
		instance: {
			entries: { web: 'https://staging.shop.example' },
			environment: 'Shared staging',
			references: ['STAGING_LOGIN'],
		},
	})
	retireInstance(store, agent, { targetId: value.targetId, instanceId: 'preview' })
	seedLogin(store)
	seedAccount(store)
	seedCheckout(store)
	seedLoginRun(store)
	seedRevision(store)
	seedSearch(store)
	seedCheckoutRun(store)
	seedStartedRun(store)
}

const showcasePlans: Array<{ planId: string; request: PlanRequest; tests: Array<[string, string, string]> }> = [
	{
		planId: 'shipping',
		request: {
			objective: 'Verify delivery fees and the delivery date on the confirmation.',
			requirements: [
				{ id: 'H1', text: 'Standard delivery is free above 200 PLN.', source: 'brief://shipping#free' },
				{ id: 'H2', text: 'Express delivery costs 25 PLN.', source: 'brief://shipping#express' },
				{ id: 'H3', text: 'The confirmation shows the delivery date.', source: 'brief://shipping#date' },
			],
			sourceContext: [{ uri: 'brief://shipping', content: 'Free standard delivery above 200 PLN.' }],
		},
		tests: [
			['H1', 'Free standard delivery', 'The delivery fee is 0 PLN for a 240 PLN cart.'],
			['H2', 'Express fee', 'The delivery fee is 25 PLN for express delivery.'],
			['H3', 'Delivery date', 'The confirmation shows a delivery date.'],
		],
	},
	{
		planId: 'returns',
		request: {
			objective: 'Verify the return form and the return label.',
			requirements: [
				{
					id: 'N1',
					text: 'A customer can start a return from the order page.',
					source: 'brief://returns#start',
				},
				{ id: 'N2', text: 'The return label is a PDF download.', source: 'brief://returns#label' },
			],
			sourceContext: [{ uri: 'brief://returns', content: 'Returns start from the order page.' }],
		},
		tests: [
			['N1', 'Start a return', 'The order page opens the return form.'],
			['N2', 'Return label', 'The label downloads as a PDF.'],
		],
	},
]

const coupons: PlanRequest = {
	objective: 'Verify coupon codes: one per order, expiry, case, and totals.',
	requirements: [
		{ id: 'C1', text: 'One coupon applies per order.', source: 'ticket://SHOP-412#one' },
		{ id: 'C2', text: 'An expired code is refused.', source: 'ticket://SHOP-412#expiry' },
		{ id: 'C3', text: 'A code is not case sensitive.', source: 'ticket://SHOP-412#case' },
		{ id: 'C4', text: 'A coupon never makes the total negative.', source: 'ticket://SHOP-412#total' },
	],
	sourceContext: [{ uri: 'ticket://SHOP-412', content: 'Coupon rules for checkout.' }],
}

function explore(
	store: Store,
	planId: string,
	explorationId: string,
	build: string,
	minutes: number,
	found: Record<string, unknown[]>
) {
	minutesAgo(minutes)
	openExploration(store, 'checkmate', { planId, build, explorationId, instance: 'local' })
	event(store, explorationId, { step: 'start', detail: { ...launch, explorers: Object.keys(found).length } })
	event(store, explorationId, { step: 'supervisor', detail: { pid: process.pid } })
	for (const explorer of Object.keys(found)) launched(store, explorationId, explorer)
	minutesAgo(minutes - 20)
	for (const [explorer, list] of Object.entries(found)) ended(store, explorationId, explorer, list)
	minutesAgo(minutes - 30)
	done(store, explorationId)
}

function criterion(id: string, rule: string, verdict: 'ok' | 'wrong', saw: string) {
	return { kind: 'criterion', id, rule, text: `Checked ${rule}.`, verdict, saw }
}

function defect(id: string, rule: string, severity: string, title: string, expected: string, actual: string) {
	return {
		kind: 'defect',
		id,
		rule,
		severity,
		title,
		expected,
		actual,
		steps: ['Open the shop.', 'Follow the rule.'],
	}
}

function acceptedPlan(store: Store, plan: (typeof showcasePlans)[number], minutes: number, runId: string) {
	minutesAgo(minutes)
	openPlan(store, agent, { planId: plan.planId, target: 'shop-local@1', request: plan.request })
	savePlan(store, agent, {
		planId: plan.planId,
		candidate: {
			tests: plan.tests.map(([rule, title, check], index) => ({
				id: `T${index + 1}`,
				title,
				requirementIds: [rule],
				capability: 'browser',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: `Check that ${check.charAt(0).toLowerCase()}${check.slice(1)}`,
				assertions: [{ id: 'A1', check, checkKind: 'agent_observation' }],
			})),
			gaps: [],
		},
	})
	minutesAgo(minutes - 10)
	approvePlan(store, human, { reference: `${plan.planId}@1`, rationale: 'Each rule has a clear check.' })
	const rules = plan.tests.map(([rule, , check]) => [rule, check])
	explore(store, plan.planId, `${runId}-x1`, 'fixture-build-1', minutes - 30, {
		e1: rules.map(([rule, check], index) =>
			criterion(`C${index + 1}`, rule, index === 1 ? 'wrong' : 'ok', index === 1 ? 'Not yet.' : check)
		),
	})
	explore(store, plan.planId, `${runId}-x2`, 'fixture-build-2', minutes - 120, {
		e1: rules.map(([rule, check], index) => criterion(`C${index + 11}`, rule, 'ok', check)),
	})
	minutesAgo(minutes - 160)
	beginRun(store, agent, { runId, reference: `${plan.planId}@1`, build: 'fixture-build-2', instance: 'local' })
	plan.tests.forEach(([, , text], index) => {
		check(store, runId, `T${index + 1}.A1`, 'passed', text, [`T${index + 1}.txt`, `${text}\n`])
		closeTest(store, agent, { runId, testId: `T${index + 1}` })
	})
	finishRun(store, agent, {
		runId,
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Nothing to clean.',
	})
	minutesAgo(minutes - 180)
	acceptResult(store, human, { runId, rationale: 'Every check passed with evidence.' })
}

function seedShowcasePlans(store: Store, screenshot: Buffer) {
	acceptedPlan(store, showcasePlans[0], 900, 'run-4')
	acceptedPlan(store, showcasePlans[1], 700, 'run-5')
	minutesAgo(2000)
	openPlan(store, agent, { planId: 'coupons', target: 'shop-local@1', request: coupons })
	explore(store, 'coupons', 'x-3', 'fixture-build-1', 1500, {
		k1: [
			criterion('C1', 'C2', 'ok', 'WINTER10 is refused after its end date.'),
			criterion('C2', 'C3', 'wrong', 'spring40 is refused.'),
			defect('D1', 'C1', 'critical', 'Two coupons stack on one order', 'One coupon applies.', 'Both apply.'),
			defect('D2', 'C4', 'high', 'A large coupon gives a negative total', 'The total is 0 PLN.', '-40 PLN.'),
		],
	})
	explore(store, 'coupons', 'x-4', 'fixture-build-2', 300, {
		k1: [
			{ kind: 'verdict', defect: 'D1', result: 'fixed' },
			{ kind: 'verdict', defect: 'D2', result: 'not_fixed' },
			criterion('C3', 'C1', 'ok', 'The second code is refused.'),
			criterion('C4', 'C2', 'ok', 'WINTER10 is refused after its end date.'),
			{
				kind: 'question',
				id: 'Q1',
				rule: 'C3',
				blocking: true,
				question: 'Must a code with a trailing space still apply?',
			},
		],
	})
	explore(store, 'checkout', 'x-1', 'fixture-build-1', 400, {
		q1: [
			criterion('C1', 'R1', 'ok', 'Confirmation shows "Total: 400.00 PLN".'),
			defect(
				'D1',
				'R2',
				'high',
				'The promotion stacks with the loyalty credit',
				'Total 240 PLN.',
				'Total 220 PLN.'
			),
			defect('D2', 'R4', 'medium', 'The checkout page has no promotion banner', 'A banner.', 'No banner.'),
		],
	})
	explore(store, 'checkout', 'x-2', 'fixture-build-2', 60, {
		q1: [
			{ kind: 'verdict', defect: 'D1', result: 'not_fixed' },
			{ kind: 'verdict', defect: 'D2', result: 'fixed' },
			criterion('C2', 'R1', 'ok', 'Confirmation shows "Total: 400.00 PLN".'),
			criterion('C3', 'R4', 'ok', 'Banner visible above the cart.'),
		],
		a1: [
			{
				kind: 'defect',
				id: 'D1',
				title: 'Two coupons stack',
				severity: 'high',
				expected: 'One coupon applies.',
				actual: 'Both coupons apply.',
				suspected: true,
				steps: ['Add LAMP-01 (400 PLN) to the cart.', 'Apply SPRING40.', 'Apply WELCOME10.', 'Read the total.'],
				evidence: [
					evidence(store, 'x-2', 'a1-checkout.png', screenshot),
					evidence(
						store,
						'x-2',
						'a1-quote.json',
						json({
							request: { method: 'POST', path: '/api/quote', body: { codes: ['SPRING40', 'WELCOME10'] } },
							response: {
								status: 200,
								body: {
									subtotalPLN: 400,
									discounts: [
										{ code: 'SPRING40', amountPLN: 160 },
										{ code: 'WELCOME10', amountPLN: 40 },
									],
									totalPLN: 200,
								},
							},
						})
					),
				],
			},
		],
	})
}

export function seedShowcase(workspace: string, screenshot: Buffer = pageShot('confirmation')) {
	const store = openStore(workspace)
	try {
		withDemoClock(() => {
			minutesAgo(5000)
			const value = profile()
			openTarget(store, agent, {
				targetId: value.targetId,
				entryPoints: value.entryPoints,
				capabilities: value.capabilities,
				allowedOperations: value.allowedOperations,
			})
			saveTarget(store, agent, { targetId: value.targetId, profile: value })
			addInstance(store, agent, {
				targetId: value.targetId,
				instanceId: 'local',
				instance: { entries: { web: 'http://127.0.0.1:4173' }, environment: 'Local fixture' },
			})
			addInstance(store, agent, {
				targetId: value.targetId,
				instanceId: 'staging',
				instance: { entries: { web: 'https://staging.shop.example' }, environment: 'Shared staging' },
			})
			seedLogin(store)
			seedCheckout(store)
			seedLoginRun(store)
			seedRevision(store)
			seedSearch(store)
			seedCheckoutRun(store)
			seedStartedRun(store)
			seedShowcasePlans(store, screenshot)
		})
	} finally {
		closeStore(store)
	}
}
