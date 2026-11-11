import type { PlanCandidate, PlanRequest, Profile } from '../plugin/src/types.ts'
import type { Store } from '../plugin/src/store.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import {
	acceptResult,
	answerGap,
	approvePlan,
	beginRun,
	checkAssertion,
	closeStore,
	closeTest,
	finishRun,
	openPlan,
	openStore,
	openTarget,
	recordFinding,
	recordGap,
	revisePlan,
	savePlan,
	saveTarget,
} from '../plugin/src/index.ts'

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

function minutesAgo(minutes: number) {
	offsetMinutes = minutes
}

export function profile(): Profile {
	return {
		contractVersion: 'toolkit-2',
		targetId: 'shop-local',
		revision: 1,
		baseUrl: 'http://127.0.0.1:4173',
		environment: 'local_fixture',
		capabilities: ['browser', 'http'],
		tooling: [
			{ capability: 'browser', executable: 'playwright-cli', version: '0.1.23' },
			{ capability: 'http', executable: 'node', version: '24.12.0' },
		],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['sign_in', 'read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		startup: { owner: 'caller', command: null },
		cleanup: 'Close the run browser session. The fixture stores no records.',
		readyForLiveExecution: true,
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
				{ id: 'A1', check: 'The account page shows the customer name.', oracleKind: 'agent_observation' },
				{ id: 'A2', check: 'The session cookie has the HttpOnly flag.', oracleKind: 'deterministic' },
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
				{ id: 'A1', check: 'The sixth attempt returns HTTP 423.', oracleKind: 'deterministic' },
				{ id: 'A2', check: 'The response names the unlock time.', oracleKind: 'agent_observation' },
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
				{ id: 'A1', check: 'The confirmation shows a total of 400 PLN.', oracleKind: 'agent_observation' },
				{ id: 'A2', check: 'The order API returns one line item.', oracleKind: 'deterministic' },
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
			assertions: [
				{ id: 'A1', check: 'The response status is HTTP 200.', oracleKind: 'deterministic' },
				{ id: 'A2', check: 'totalPLN equals 220.', oracleKind: 'deterministic' },
				{ id: 'A3', check: 'The quote does not list the loyalty discount.', oracleKind: 'deterministic' },
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
				{ id: 'A1', check: 'The checkout page shows a promotion banner.', oracleKind: 'agent_observation' },
				{ id: 'A2', check: 'The banner states a 40 percent discount.', oracleKind: 'agent_observation' },
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
				{ id: 'A1', check: 'The first three results are lamps.', oracleKind: 'agent_observation' },
				{ id: 'A2', check: 'The result count is 12.', oracleKind: 'deterministic' },
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
					oracleKind: 'agent_observation',
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
	result: 'passed' | 'failed' | 'inconclusive',
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
	beginRun(store, agent, { runId: 'run-3', reference: 'login@1', tests: ['T1', 'T2'], build: 'fixture-build-2' })
	check(store, 'run-3', 'T1.A1', 'passed', 'Account page shows "Anna Nowak".', [
		'T1-account.png',
		pageShot('account'),
	])
	check(store, 'run-3', 'T1.A2', 'passed', 'Set-Cookie: sid=…; HttpOnly; SameSite=Lax', [
		'T1-cookie.txt',
		'Set-Cookie: sid=redacted; Path=/; HttpOnly; SameSite=Lax\n',
	])
	closeTest(store, agent, { runId: 'run-3', testId: 'T1' })
	check(store, 'run-3', 'T2.A1', 'passed', 'HTTP 423 Locked on attempt 6', [
		'T2-lockout.json',
		json({ request: { attempt: 6 }, response: { status: 423 } }),
	])
	check(store, 'run-3', 'T2.A2', 'passed', 'Body says "Try again at 14:41."', [
		'T2-lockout-body.txt',
		'Your account is locked. Try again at 14:41.\n',
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
		source: 'caller://pricing-decisions#spring40',
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
		delta: { tests: { T2: { assertions: { A2: { check: 'totalPLN equals 240.' } } } } },
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
		partial: 'ready_only',
	})
	check(store, 'run-7', 'T1.A1', 'passed', 'Confirmation shows "Total: 400.00 PLN".', [
		'T1-confirmation.png',
		pageShot('confirmation'),
	])
	check(store, 'run-7', 'T1.A2', 'passed', 'lineItems has 1 entry.', [
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
	check(store, 'run-7', 'T2.A1', 'passed', 'HTTP 200', ['T2-quote-status.json', quote])
	const failed = check(store, 'run-7', 'T2.A2', 'failed', 'totalPLN = 220', ['T2-quote.json', quote])
	check(store, 'run-7', 'T2.A3', 'passed', 'No loyalty line in the quote.', [
		'T2-quote-lines.txt',
		'Lines: SPRING40 −160 PLN\nNo loyalty line.\n',
	])
	recordFinding(store, agent, {
		runId: 'run-7',
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T2.A2'],
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

function seedSearch(store: Store) {
	minutesAgo(50)
	openPlan(store, agent, { planId: 'search', target: 'shop-local@1', request: searchRequest })
	savePlan(store, agent, { planId: 'search', candidate: searchCandidate })
}

function seedStartedRun(store: Store) {
	minutesAgo(5)
	beginRun(store, agent, { runId: 'run-8', reference: 'login@1', tests: ['T1', 'T2'], build: 'fixture-build-3' })
	minutesAgo(3)
	check(store, 'run-8', 'T1.A1', 'passed', 'Account page shows "Anna Nowak".', [
		'T1-account.png',
		pageShot('account'),
	])
}

export function seedDemo(workspace: string) {
	const store = openStore(workspace)
	globalThis.Date = DemoDate as DateConstructor
	try {
		minutesAgo(5000)
		const value = profile()
		openTarget(store, agent, {
			targetId: value.targetId,
			baseUrl: value.baseUrl,
			capabilities: value.capabilities,
			allowedOperations: value.allowedOperations,
		})
		saveTarget(store, agent, { targetId: value.targetId, profile: value })
		seedLogin(store)
		seedCheckout(store)
		seedLoginRun(store)
		seedRevision(store)
		seedSearch(store)
		seedCheckoutRun(store)
		seedStartedRun(store)
	} finally {
		globalThis.Date = RealDate
		closeStore(store)
	}
}
