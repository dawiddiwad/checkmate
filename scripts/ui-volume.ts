import type { Store } from '../plugin/src/store.ts'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { answerGap, closeStore, openPlan, openStore } from '../plugin/src/index.ts'
import { openExploration } from '../plugin/src/explorations.ts'
import { decideClaim, handOffClaims } from '../plugin/src/journal.ts'
import { harvestExploration } from '../plugin/src/harvest.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { done, ended, entries, event, launch, launched, report } from '../test/explorations.ts'
import { spawn, spawnSync } from 'node:child_process'
import { agent, human, minutesAgo, pageShot, seedDemo, withDemoClock } from './ui-demo.ts'

type Defect = [title: string, expected: string, actual: string, steps: string[]]
type Fate = 'observed' | 'suspected' | 'confirmed' | 'unresolved' | 'accepted' | 'rejected'
type Spec = {
	planId: string
	explorationId: string
	build: string
	instance: string
	daysAgo: number
	explorers: string[]
	defects: Array<{ defect: Defect; severity: string; fate: Fate; image: boolean }>
	questions: Array<{ question: string; blocking: boolean; answer: string | null }>
}

const day = 24 * 60

const defects: Defect[] = [
	[
		'Two coupons stack on one order',
		'Only one coupon applies to an order.',
		'Both SPRING40 and WELCOME10 apply, and the total drops below the cost price.',
		['Add LAMP-01 to the cart.', 'Apply SPRING40.', 'Apply WELCOME10.', 'Read the total.'],
	],
	[
		'The basket count does not update after a remove',
		'The header count shows the number of lines in the basket.',
		'The header still shows 3 after the last line is removed. A reload shows 2.',
		['Add three items.', 'Remove one item from the basket page.', 'Read the header count.'],
	],
	[
		'The checkout total ignores the shipping fee for express delivery',
		'The total includes the 25 PLN express fee.',
		'The summary shows the fee, but the total and the charged amount do not include it.',
		['Add one item.', 'Choose express delivery.', 'Compare the line items and the total.'],
	],
	[
		'The password reset link works twice',
		'A reset link is valid for one use only.',
		'The same link sets a new password a second time, 20 minutes after the first use.',
		['Ask for a reset link.', 'Set a new password.', 'Open the same link again and set another password.'],
	],
	[
		'Search returns no result for a term with a trailing space',
		'"lamp " gives the same results as "lamp".',
		'The page says that nothing matches.',
		['Type "lamp " with a trailing space.', 'Press Enter.'],
	],
	[
		'The address form accepts a postal code with letters for Poland',
		'The form refuses a postal code that is not in the NN-NNN format.',
		'The form saves "AB-123" and the order goes to the warehouse with it.',
		['Open the address book.', 'Add an address in Poland with the postal code AB-123.', 'Save.'],
	],
	[
		'The order history shows orders of another customer after a sign-out',
		'After a sign-out and a sign-in as another customer, only that customer’s orders show.',
		'The list shows the orders of the previous customer until the page is reloaded.',
		['Sign in as anna@example.test.', 'Open the order history.', 'Sign out.', 'Sign in as ben@example.test.'],
	],
	[
		'The refund button shows for an order that is not delivered',
		'Only delivered orders show the refund button.',
		'An order in the state "packed" shows the button, and the request is accepted.',
		['Open an order in the state packed.', 'Read the actions.'],
	],
	[
		'The price filter excludes items at the upper limit',
		'A filter of 100 to 200 PLN includes an item at 200 PLN.',
		'The 200 PLN lamp is missing from the results.',
		['Open the lamps category.', 'Set the price filter to 100–200.', 'Look for LAMP-07 at 200 PLN.'],
	],
	[
		'The gift card balance goes negative',
		'A gift card cannot pay more than its balance.',
		'Two parallel checkouts each take the full 100 PLN, and the balance shows −100 PLN.',
		['Open two tabs with one basket each.', 'Pay with the same gift card in both tabs at the same time.'],
	],
	[
		'The product page shows the wrong currency after a language change',
		'The currency follows the market, not the language.',
		'A change to English shows the prices in USD with the PLN amounts.',
		['Open a product page.', 'Change the language to English.', 'Read the price.'],
	],
	[
		'The quantity field accepts zero',
		'The minimum quantity is 1.',
		'A quantity of 0 keeps the line in the basket with a total of 0 PLN.',
		['Add an item.', 'Set the quantity to 0.', 'Open the checkout.'],
	],
	[
		'The session does not expire after 30 minutes of no activity',
		'The account signs out after 30 minutes without a request.',
		'The account is still signed in after 75 minutes.',
		['Sign in.', 'Wait 75 minutes.', 'Open the account page.'],
	],
	[
		'The wishlist loses items when the basket is merged at sign-in',
		'Items in the wishlist stay after a sign-in.',
		'The wishlist is empty after a guest basket merges into the account.',
		['Add two items to the wishlist as a signed-in customer.', 'Sign out.', 'Add an item as a guest.', 'Sign in.'],
	],
	[
		'The review form allows a rating of six stars',
		'A rating is 1 to 5.',
		'A changed request with rating 6 is saved and shows six stars.',
		['Open the review form.', 'Send the form with rating=6 through the API.'],
	],
	[
		'The tax line rounds each item instead of the total',
		'VAT is calculated on the order total and rounded once.',
		'Three items at 33.33 PLN give a VAT 0.01 PLN higher than the invoice.',
		['Add three items at 33.33 PLN.', 'Compare the VAT line with the invoice PDF.'],
	],
	[
		'The checkout page has no visible focus on the payment buttons',
		'Each control shows a focus indicator (WCAG 2.4.7).',
		'Tab moves to the payment buttons, but nothing shows where the focus is.',
		['Open the checkout.', 'Press Tab until the payment method buttons.'],
	],
	[
		'The out-of-stock badge shows for an item in stock',
		'The badge shows only when the stock is 0.',
		'LAMP-03 with a stock of 4 shows "Out of stock" on the category page, but not on its product page.',
		['Open the lamps category.', 'Find LAMP-03.'],
	],
	[
		'The order confirmation email has the wrong delivery date',
		'The email gives the same delivery date as the confirmation page.',
		'The email gives a date one day earlier when the order is placed after 22:00.',
		['Place an order at 22:30.', 'Compare the confirmation page with the email.'],
	],
	[
		'The API returns HTTP 500 for an unknown product ID',
		'GET /api/products/unknown returns HTTP 404.',
		'The API returns HTTP 500 with a stack trace in the body.',
		['Send GET /api/products/zzqx.'],
	],
	[
		'The loyalty points show before the order is paid',
		'Points show after the payment is confirmed.',
		'The account shows the points of a cancelled, unpaid order.',
		['Place an order with bank transfer.', 'Cancel it before payment.', 'Open the loyalty page.'],
	],
	[
		'The mobile menu covers the basket button',
		'The basket button stays visible when the menu is open.',
		'At 375 px width the open menu covers the basket button, and the button cannot be used.',
		['Open the shop at 375 px width.', 'Open the menu.'],
	],
	[
		'The sort by price puts items without a price first',
		'Items without a price are last.',
		'Three items with "price on request" are first in "Price: low to high".',
		['Open the lamps category.', 'Sort by price, low to high.'],
	],
	[
		'The sign-in form shows which emails exist',
		'The error text is the same for an unknown email and a wrong password.',
		'An unknown email gives "No account for this email".',
		['Sign in with nobody@example.test.', 'Read the error.'],
	],
	[
		'The discount banner overlaps the price on narrow screens',
		'The banner wraps and does not cover other text.',
		'Below 400 px the banner covers the price of the first item.',
		['Open the checkout at 360 px width.'],
	],
	[
		'The invoice PDF has no company tax ID for a business customer',
		'The invoice shows the tax ID given at checkout.',
		'The tax ID field is empty on the invoice.',
		['Check out as a business customer with a tax ID.', 'Download the invoice.'],
	],
	[
		'The basket keeps a removed coupon after a reload',
		'A removed coupon does not come back.',
		'After a reload, the removed coupon applies again.',
		['Apply SPRING40.', 'Remove it.', 'Reload the basket page.'],
	],
	[
		'The search suggestions show deleted products',
		'Suggestions show only products that are for sale.',
		'"Lamp classic" shows in the suggestions, but its page returns 404.',
		['Type "lamp c" in the search field.', 'Choose "Lamp classic".'],
	],
	[
		'The account lockout counter resets after a page reload',
		'Five failed attempts lock the account, with or without a reload.',
		'A reload between attempts resets the counter, and ten attempts do not lock the account.',
		['Send a wrong password four times.', 'Reload the page.', 'Send a wrong password four times again.'],
	],
	[
		'The order total in the account list differs from the order page',
		'The list and the order page show the same total.',
		'The list shows the total before the discount, and the order page shows the total after it.',
		['Place an order with a coupon.', 'Compare the account list with the order page.'],
	],
]

const questions = [
	'Can a coupon apply to an item that is on sale?',
	'Must the basket keep its items for a guest after 30 days?',
	'Is express delivery available on Sundays?',
	'How many days after delivery can a customer ask for a refund?',
	'Must the search find items by their SKU?',
	'Can a business customer pay by invoice without a credit check?',
	'Does the loyalty credit expire, and when?',
	'Must the price include VAT for business customers?',
	'Can a customer change the delivery address after payment?',
	'Which payment methods must show for an order above 5000 PLN?',
	'Must a product review wait for moderation?',
	'Can a customer have two accounts with one phone number?',
	'Is a gift card valid in the physical shops?',
	'Must the order history show cancelled orders?',
	'How long is a password reset link valid?',
	'Must the shop work without JavaScript?',
	'Which languages must the checkout support?',
	'Can a guest customer use a coupon?',
	'Must the stock count show on the product page?',
	'Does a cancelled order give back the loyalty points?',
	'Which browsers must the shop support?',
	'Is a minimum order value required for free delivery?',
	'Can a customer combine a gift card and a credit card?',
	'Must the invoice show the delivery fee as a separate line?',
	'What is the maximum quantity of one item in one order?',
	'Must the search ignore Polish diacritics?',
	'Can a customer delete the account from the profile page?',
	'Must the confirmation email include the invoice?',
	'Does the spring promotion apply to gift cards?',
	'Which time zone do the delivery dates use?',
	'Must a product without stock stay in search results?',
	'Can the factory reset the test data between runs?',
	'Is two-factor sign-in required for business accounts?',
	'Must the basket show the saving of each discount?',
	'Can an order mix items from two warehouses?',
	'Is a phone number required at checkout?',
	'Must the shop show a cookie banner on the first visit?',
	'Can a customer return one item of a bundle?',
	'Which error text must show for a declined card?',
	'Must prices show with two decimal places at all times?',
	'Can the promotion banner be closed, and does it come back?',
	'Must the session survive a browser restart?',
	'Does the wishlist need a sign-in?',
	'Must the API limit the requests of one client?',
	'Can a test create real orders on staging?',
]

const blocking = [0, 3, 7, 9, 22, 31, 33, 41]

const answers = [
	'No. A coupon does not apply to an item on sale.',
	'Yes. The guest basket is kept for 30 days.',
	'No. Express delivery is Monday to Saturday.',
	'Yes. The rule is the same for all customers.',
]

const plans = [
	{
		planId: 'basket',
		objective: 'Explore the basket, coupons, and the gift card flow before the spring release.',
		source: 'brief://basket',
	},
]

function evidenceFile(store: Store, explorationId: string, name: string, content: Buffer | string) {
	const directory = join(store.workspace, '.checkmate', 'tmp', 'volume', explorationId)
	mkdirSync(directory, { recursive: true })
	writeFileSync(join(directory, name), content)
	return `.checkmate/tmp/volume/${explorationId}/${name}`
}

const fates: Fate[] = [
	'suspected',
	'observed',
	'confirmed',
	'suspected',
	'unresolved',
	'observed',
	'accepted',
	'suspected',
	'rejected',
	'observed',
]
const severities = ['high', 'medium', 'low', 'critical', 'medium', 'high', 'low', 'medium']

function specs(): Spec[] {
	const layout = [
		{ planId: 'checkout', explorationId: 'x-1', build: 'fixture-build-1', daysAgo: 12, count: 9 },
		{ planId: 'checkout', explorationId: 'x-2', build: 'fixture-build-2', daysAgo: 6, count: 8 },
		{ planId: 'login', explorationId: 'x-3', build: 'fixture-build-1', daysAgo: 10, count: 6 },
		{ planId: 'login', explorationId: 'x-4', build: 'fixture-build-2', daysAgo: 3, count: 7 },
		{ planId: 'search', explorationId: 'x-5', build: 'fixture-build-2', daysAgo: 8, count: 9 },
		{ planId: 'basket', explorationId: 'x-7', build: 'fixture-build-1', daysAgo: 9, count: 11 },
		{ planId: 'basket', explorationId: 'x-8', build: 'fixture-build-2', daysAgo: 2, count: 10 },
	]
	let next = 0
	let asked = 0
	return layout.map((item, index) => {
		const letter = 'abcdefghij'[index]
		const own = Array.from({ length: item.count }, () => {
			const i = next++
			const base = defects[i % defects.length]
			const defect: Defect =
				i < defects.length
					? base
					: [`${base[0]} in the API`, base[1], `${base[2]} The API gives the same result.`, base[3]]
			return {
				defect,
				severity: severities[i % severities.length],
				fate: fates[i % fates.length],
				image: i % 3 === 0,
			}
		})
		const asks = Array.from({ length: index < 5 ? 12 : 13 }, () => {
			const i = asked++
			const text = questions[i % questions.length]
			const question = i < questions.length ? text : text.replace(/\?$/, ' for a guest customer?')
			const answered = i % 5 === 1 || i === 3 || i === 7
			return {
				question,
				blocking: blocking.includes(i),
				answer: answered ? answers[i % answers.length] : null,
			}
		})
		return {
			planId: item.planId,
			explorationId: item.explorationId,
			build: item.build,
			instance: 'local',
			daysAgo: item.daysAgo,
			explorers: [`${letter}1`, `${letter}2`, `${letter}3`],
			defects: own,
			questions: asks,
		}
	})
}

function explore(store: Store, spec: Spec) {
	const start = spec.daysAgo * day
	minutesAgo(start)
	openExploration(store, 'checkmate', {
		planId: spec.planId,
		build: spec.build,
		explorationId: spec.explorationId,
		instance: spec.instance,
	})
	event(store, spec.explorationId, { step: 'start', detail: { ...launch, explorers: spec.explorers.length } })
	event(store, spec.explorationId, { step: 'supervisor', detail: { pid: process.pid } })
	for (const explorer of spec.explorers) launched(store, spec.explorationId, explorer)
	const ids = new Map<string, string>()
	spec.explorers.forEach((explorer, which) => {
		minutesAgo(start - 20 - which * 5)
		const found = spec.defects
			.map((item, index) => ({ item, index }))
			.filter(({ index }) => index % spec.explorers.length === which)
			.map(({ item, index }) => {
				ids.set(`${index}`, `${explorer}/D${index + 1}`)
				const evidence = [
					...(item.image
						? [evidenceFile(store, spec.explorationId, `${explorer}-D${index + 1}.png`, pageShot('banner'))]
						: []),
					evidenceFile(
						store,
						spec.explorationId,
						`${explorer}-D${index + 1}.txt`,
						`${item.defect[2]}\nRequest id: ${spec.explorationId}-${index + 1}\n`
					),
				]
				return {
					kind: 'defect',
					id: `D${index + 1}`,
					title: item.defect[0],
					expected: item.defect[1],
					actual: item.defect[2],
					severity: item.severity,
					...(item.fate === 'suspected' ? { suspected: true } : {}),
					...(item.fate === 'suspected' && index % 2 ? {} : { steps: item.defect[3], evidence }),
				}
			})
		const asked = spec.questions
			.map((item, index) => ({ item, index }))
			.filter(({ index }) => index % spec.explorers.length === which)
			.map(({ item, index }) => ({
				kind: 'question',
				id: `Q${index + 1}`,
				question: item.question,
				...(item.blocking ? { blocking: true } : {}),
			}))
		ended(store, spec.explorationId, explorer, [...found, ...asked])
	})
	const checks = spec.defects.flatMap((item, index): Array<Record<string, string>> => {
		const claim = ids.get(`${index}`)!
		if (item.fate === 'confirmed' || item.fate === 'accepted')
			return [{ kind: 'observation', confirms: claim, saw: 'The verifier saw the same result.' }]
		if (item.fate === 'unresolved')
			return [
				{
					kind: 'observation',
					refutes: claim,
					saw: 'The verifier did the steps twice and saw the expected result.',
				},
			]
		return []
	})
	if (checks.length) entries(store, spec.explorationId, 'verify', checks)
	report(
		store,
		spec.explorationId,
		spec.explorers[0],
		`# Report of ${spec.explorers[0]}\n\nThe explorer tested ${spec.planId}.\n`
	)
	minutesAgo(start - 60)
	done(store, spec.explorationId)
	minutesAgo(start - 120)
	spec.defects.forEach((item, index) => {
		if (item.fate !== 'accepted' && item.fate !== 'rejected') return
		decideClaim(store, human, {
			planId: spec.planId,
			claimId: ids.get(`${index}`)!,
			verdict: item.fate === 'accepted' ? 'approved' : 'rejected',
			rationale:
				item.fate === 'accepted'
					? 'The steps show the defect on the fixture.'
					: 'This is the intended behaviour.',
		})
	})
	spec.questions.forEach((item, index) => {
		if (!item.answer) return
		answerGap(store, human, {
			planId: spec.planId,
			gapId: `${spec.explorers[index % spec.explorers.length]}/Q${index + 1}`,
			kind: 'accept_assumption',
			value: item.answer,
			rationale: 'The product owner gave this rule in the planning meeting.',
		})
	})
}

function merge(store: Store, planId: string, explorationId: string, members: string[][]) {
	entries(
		store,
		explorationId,
		'merge',
		members.map((group, index) => ({
			kind: 'topic',
			id: `T${index + 1}`,
			question: `${questions[index + 20]} (asked by ${group.length} explorers)`,
			members: group,
		}))
	)
}

function running(store: Store) {
	minutesAgo(25)
	openExploration(store, 'checkmate', {
		planId: 'checkout',
		build: 'fixture-build-3',
		explorationId: 'x-9',
		instance: 'staging',
	})
	event(store, 'x-9', { step: 'start', detail: { ...launch, explorers: 3, path: 'session' } })
	event(store, 'x-9', { step: 'action', explorer: 'r1', detail: { step: 'test' } })
	event(store, 'x-9', { step: 'started', explorer: 'r1' })
	event(store, 'x-9', { step: 'action', explorer: 'r2', detail: { step: 'study' } })
	event(store, 'x-9', {
		step: 'turn',
		explorer: 'r2',
		status: 'completed',
		detail: { activity: 'Studied the checkout and the coupon rules.' },
	})
	event(store, 'x-9', { step: 'action', explorer: 'r3', detail: { step: 'test' } })
	minutesAgo(8)
	entries(store, 'x-9', 'r1', [
		{
			kind: 'defect',
			id: 'D1',
			title: 'The express fee is missing from the total again',
			expected: 'The total includes the 25 PLN express fee.',
			actual: 'The total is 400 PLN with express delivery.',
			severity: 'high',
			steps: ['Add one item.', 'Choose express delivery.'],
		},
		{ kind: 'question', id: 'Q1', question: 'Is the express fee free above 1000 PLN?' },
	])
}

function processRuns(store: Store) {
	const gone = spawnSync(process.execPath, ['-e', '']).pid!
	const alive = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1200000)'], { detached: true, stdio: 'ignore' })
	alive.unref()
	const open = (planId: string, explorationId: string, build: string, instance: string) => {
		openExploration(store, 'checkmate', { planId, build, explorationId, instance })
		event(store, explorationId, { step: 'start', detail: { ...launch, explorers: 2 } })
	}
	minutesAgo(14)
	open('login', 'x-14', 'fixture-build-3', 'local')
	event(store, 'x-14', { step: 'supervisor', detail: { pid: alive.pid } })
	event(store, 'x-14', { step: 'rules', status: 'completed', detail: { costUsd: 0.12 } })
	for (const explorer of ['a1', 'a2']) launched(store, 'x-14', explorer)
	minutesAgo(9)
	for (const explorer of ['a1', 'a2'])
		event(store, 'x-14', { step: 'turn', explorer, detail: { turn: 'test', session: `session-${explorer}` } })
	minutesAgo(3 * day)
	open('account', 'x-15', 'fixture-build-4', 'local')
	event(store, 'x-15', { step: 'supervisor', detail: { pid: gone } })
	launched(store, 'x-15', 'a1')
	minutesAgo(3 * day - 6)
	event(store, 'x-15', {
		step: 'stop',
		detail: { actor: 'ana', reason: 'The build is the wrong one.', was: 'testing' },
	})
	minutesAgo(2 * day)
	open('account', 'x-16', 'fixture-build-1', 'local')
	event(store, 'x-16', { step: 'supervisor', detail: { pid: gone } })
	minutesAgo(2 * day - 1)
	done(store, 'x-16', 'failed', { reason: 'No claude executable on PATH. Nothing changed.' })
	minutesAgo(1 * day)
	open('account', 'x-17', 'fixture-build-2', 'local')
	event(store, 'x-17', { step: 'supervisor', detail: { pid: gone } })
	launched(store, 'x-17', 'a1')
	minutesAgo(2 * 60)
	open('search', 'x-18', 'fixture-build-5', 'local')
	event(store, 'x-18', { step: 'supervisor', detail: { pid: process.pid } })
	launched(store, 'x-18', 'a1')
	ended(store, 'x-18', 'a1', [{ kind: 'question', id: 'Q1', question: 'Does the search ignore case?' }])
	done(store, 'x-18')
	answerGap(store, human, {
		planId: 'search',
		gapId: 'a1/Q1',
		kind: 'defer',
		value: 'Decide later.',
		rationale: 'The owner has not decided yet.',
	})
}

function paused(store: Store) {
	minutesAgo(90)
	openExploration(store, 'checkmate', {
		planId: 'basket',
		build: 'fixture-build-3',
		explorationId: 'x-10',
		instance: 'local',
	})
	event(store, 'x-10', { step: 'start', detail: { ...launch, explorers: 2, path: 'session' } })
	event(store, 'x-10', { step: 'action', explorer: 'p1', detail: { step: 'test' } })
	event(store, 'x-10', { step: 'started', explorer: 'p1' })
	minutesAgo(70)
	event(store, 'x-10', {
		step: 'pause',
		detail: { reason: 'The explorer needs a second test account with a gift card.' },
	})
}

function failed(store: Store) {
	minutesAgo(4 * day)
	openExploration(store, 'checkmate', {
		planId: 'search',
		build: 'fixture-build-3',
		explorationId: 'x-6',
		instance: 'local',
	})
	event(store, 'x-6', { step: 'start', detail: launch })
	event(store, 'x-6', { step: 'supervisor', detail: { pid: process.pid } })
	launched(store, 'x-6', 'f1')
	minutesAgo(4 * day - 15)
	done(store, 'x-6', 'failed', { reason: 'The instance local did not answer on http://127.0.0.1:4173.' })
}

const ruleAreas: Array<[area: string, rules: string[]]> = [
	[
		'Codes',
		[
			'A code works in upper case and in lower case.',
			'A code with spaces before or after it works.',
			'An unknown code shows "This code does not exist".',
			'An expired code shows the date on which it ended.',
			'A code applies once to an order.',
			'The code field accepts at most 32 characters.',
		],
	],
	[
		'Stacking',
		[
			'Only one coupon applies to an order.',
			'A second coupon replaces the first one after a confirm step.',
			'A coupon and a gift card can pay one order together.',
			'A coupon does not apply to an item that is on sale.',
			'A free delivery coupon combines with a price coupon.',
		],
	],
	[
		'Basket totals',
		[
			'The discount shows as its own line in the basket.',
			'The total never drops below zero.',
			'Tax is calculated after the discount.',
			'The delivery fee is not discounted.',
			'The saving shows with two decimal places.',
			'A percentage coupon rounds to the nearest grosz.',
			'The basket total and the charged amount are equal.',
			'A removed coupon removes its discount line at once.',
			'The total updates without a page reload.',
			'The basket shows the saving of each discount.',
			'A bundle counts as one item for a coupon.',
		],
	],
	[
		'Expiry and limits',
		[
			'A coupon is valid until the end of its last day in the shop time zone.',
			'A coupon with a minimum order value applies only above that value.',
			'A coupon for first orders applies to a first order only.',
			'A coupon with a use limit stops at the limit.',
			'A cancelled order gives the coupon use back.',
		],
	],
	[
		'Gift cards',
		[
			'A gift card cannot pay more than its balance.',
			'The gift card balance shows after each payment.',
			'A gift card cannot buy another gift card.',
			'A gift card stays valid for 24 months.',
		],
	],
	[
		'Guest checkout',
		[
			'A guest can use a coupon.',
			'A guest keeps the coupon after a sign-in at checkout.',
			'A guest basket is kept for 30 days.',
			'A guest gets the order confirmation by e-mail.',
			'A guest cannot use a coupon for first orders twice with one e-mail.',
		],
	],
	[
		'Refunds after a partial return',
		[
			'A partial return refunds the item price less its share of the discount.',
			'The refund of a returned bundle item uses the bundle price.',
			'A refund never exceeds the amount paid.',
			'A refund to a gift card restores its balance.',
			'The refund e-mail lists the discount that was taken back.',
			'A returned item with a coupon of its own refunds the coupon value too.',
		],
	],
	['API', ['The coupon API refuses more than 10 tries a minute from one client.']],
	[
		'Notifications',
		[
			'A customer gets an e-mail 3 days before a personal coupon ends.',
			'The e-mail names the code and its end date.',
			'A customer can turn off coupon e-mails.',
			'A coupon e-mail is never sent twice for one coupon.',
			'The e-mail links to the basket with the code filled in.',
		],
	],
]

const lateCodes = ['A code from a partner shop shows the partner name.', 'A code for staff needs a staff account.']

function couponRules() {
	let next = 1
	const listed = ruleAreas.flatMap(([area, texts]) =>
		texts.map((text) => ({ id: `R${next++}`, text, source: 'ticket://SHOP-412#acceptance', area }))
	)
	return [
		...listed,
		...lateCodes.map((text) => ({ id: `R${next++}`, text, source: 'ticket://SHOP-412#acceptance', area: 'Codes' })),
	]
}

const couponDefects = [
	{ id: 'D1', rule: 'R7', severity: 'critical', title: 'Two coupons stack on one order' },
	{ id: 'D2', rule: 'R13', severity: 'critical', title: 'A coupon larger than the order gives a negative total' },
	{ id: 'D3', rule: 'R14', severity: 'high', title: 'Tax is calculated before the discount' },
	{ id: 'D4', rule: 'R1', severity: 'high', title: 'A lower case code is refused' },
	{
		id: 'D5',
		suspected: true,
		rule: 'R23',
		severity: 'medium',
		title: 'A coupon ends at midnight UTC, not in the shop time zone',
	},
	{ id: 'D6', rule: 'R28', severity: 'high', title: 'The gift card balance goes negative' },
	{
		id: 'D7',
		suspected: true,
		rule: 'R33',
		severity: 'medium',
		title: 'A guest loses the coupon when signing in at checkout',
	},
	{ id: 'D8', rule: 'R16', severity: 'low', title: 'The saving shows three decimal places' },
	{ id: 'D9', rule: 'R37', severity: 'high', title: 'A partial return refunds the full item price' },
	{ id: 'D10', suspected: true, rule: 'R10', severity: 'medium', title: 'The coupon also applies to sale items' },
	{ id: 'D11', rule: 'outside', severity: 'low', title: 'The basket page logs a warning in the console' },
	{ id: 'D12', suspected: true, rule: 'R43', severity: 'medium', title: 'The coupon API takes 50 tries a minute' },
]

const couponQuestions = [
	{ id: 'Q1', rule: 'R9', blocking: true, question: 'Can a coupon and a gift card pay one order together?' },
	{ id: 'Q2', rule: 'R11', blocking: false, question: 'Does a free delivery coupon combine with a price coupon?' },
	{ id: 'Q3', rule: 'R23', blocking: true, question: 'Is a coupon valid until the end of its last day?' },
	{ id: 'Q4', rule: 'R24', blocking: false, question: 'Is a minimum order value counted before or after tax?' },
	{ id: 'Q5', rule: 'R22', blocking: false, question: 'Does a coupon count the items of a bundle one by one?' },
	{ id: 'Q6', rule: 'R32', blocking: true, question: 'Can a guest customer use a coupon?' },
	{ id: 'Q7', rule: 'R38', blocking: false, question: 'Which price does the refund of a bundle item use?' },
	{
		id: 'Q8',
		rule: 'R46',
		blocking: false,
		question: 'Can a customer turn off coupon e-mails only, and keep order e-mails?',
	},
	{
		id: 'Q9',
		rule: 'outside',
		blocking: false,
		question: 'Must the shop show the coupon field on the product page too?',
	},
	{ id: 'Q10', rule: 'R49', blocking: false, question: 'Which partner name shows for a code from a partner shop?' },
]

function couponEntries(build: number, rules: Array<{ id: string }>) {
	const criteria = rules
		.map((rule, index) => ({ rule, index }))
		.filter(({ index }) => (index + build) % 4 !== 0)
		.map(({ rule, index }) => ({
			kind: 'criterion',
			id: `C${build * 100 + index + 1}`,
			rule: rule.id,
			text: `Checked ${rule.id} on build ${build + 1}.`,
			verdict: (index * 7 + build) % 6 === 0 ? 'wrong' : 'ok',
		}))
	return criteria
}

function couponTest(store: Store, explorationId: string, build: number, daysAgo: number, list: unknown[]) {
	minutesAgo(daysAgo * day)
	openExploration(store, 'checkmate', {
		planId: 'coupons',
		build: `fixture-build-${build + 1}`,
		explorationId,
		instance: 'local',
	})
	event(store, explorationId, { step: 'start', detail: { ...launch, explorers: 2 } })
	event(store, explorationId, { step: 'supervisor', detail: { pid: process.pid } })
	for (const explorer of ['k1', 'k2']) launched(store, explorationId, explorer)
	minutesAgo(daysAgo * day - 30)
	ended(store, explorationId, 'k1', list)
	ended(store, explorationId, 'k2', couponEntries(build, couponRules()))
	minutesAgo(daysAgo * day - 60)
	done(store, explorationId)
}

function coupons(store: Store) {
	minutesAgo(14 * day)
	openPlan(store, agent, {
		planId: 'coupons',
		target: 'shop-local@1',
		request: {
			objective: 'Checkout coupons: one coupon per order, totals, expiry, guests, and refunds.',
			context: { sources: ['ticket://SHOP-412'] },
			requirements: couponRules(),
		},
	})
	const defect = (item: (typeof couponDefects)[number], index: number) => ({
		kind: 'defect',
		...('suspected' in item ? { suspected: true, question: `Is this intended: ${item.title.toLowerCase()}?` } : {}),
		id: item.id,
		title: item.title,
		rule: item.rule,
		severity: item.severity,
		expected: couponRules().find((rule) => rule.id === item.rule)?.text ?? 'The shop behaves as before.',
		actual: `${item.title}.`,
		steps: ['Add LAMP-01 to the basket.', 'Apply SPRING40.', 'Read the total.'],
		evidence:
			index % 3 === 0
				? [
						evidenceFile(store, 'x-11', `k1-${item.id}.png`, pageShot('banner')),
						`Seen on build 1: ${item.title}.`,
					]
				: [`Seen on build 1: ${item.title}.`],
	})
	const asked = couponQuestions.map((item) => ({
		kind: 'question',
		id: item.id,
		rule: item.rule,
		question: item.question,
		actual: 'The build allows it.',
		...(item.blocking ? { blocking: true } : {}),
	}))
	couponTest(store, 'x-11', 0, 12, [...couponDefects.slice(0, 9).map(defect), ...asked.slice(0, 6)])
	couponTest(store, 'x-12', 1, 6, [
		...couponDefects.slice(0, 9).map((item, index) => ({
			kind: 'verdict',
			defect: item.id,
			result: index % 2 ? 'not_fixed' : 'fixed',
		})),
		...couponDefects.slice(9).map(defect),
		...asked.slice(6),
	])
	couponTest(store, 'x-13', 2, 1, [
		{ kind: 'verdict', defect: 'D1', result: 'not_fixed' },
		{ kind: 'verdict', defect: 'D3', result: 'fixed' },
		{ kind: 'verdict', defect: 'D2', result: 'not_fixed' },
		{ kind: 'verdict', defect: 'D10', result: 'not_fixed' },
	])
	minutesAgo(day - 90)
	entries(store, 'x-12', 'merge', [
		{
			kind: 'topic',
			id: 'T1',
			label: 'Combining coupons',
			question: 'Which coupons combine?',
			members: ['k1/Q1', 'k1/Q2'],
		},
	])
	for (const [id, verdict] of [
		['k1/D1', 'approved'],
		['k1/D2', 'approved'],
		['k1/D3', 'approved'],
		['k1/D4', 'approved'],
		['k1/D6', 'approved'],
		['k1/D9', 'approved'],
		['k1/D8', 'rejected'],
	] as const)
		decideClaim(store, human, {
			planId: 'coupons',
			claimId: id,
			verdict,
			rationale: verdict === 'approved' ? 'The steps show the defect.' : 'Three decimals are fine here.',
		})
	handOffClaims(store, human, {
		planId: 'coupons',
		claimIds: ['k1/D4', 'k1/D6'],
		to: 'the developer of SHOP-412',
		undo: false,
	})
	answerGap(store, human, {
		planId: 'coupons',
		gapId: 'k1/Q5',
		kind: 'accept_assumption',
		value: 'A bundle counts as one item.',
		rationale: 'The product owner gave this rule.',
	})
}

export function seedVolume(workspace: string) {
	seedDemo(workspace)
	const store = openStore(workspace)
	try {
		withDemoClock(() => {
			minutesAgo(14 * day)
			for (const plan of plans)
				openPlan(store, agent, {
					planId: plan.planId,
					target: 'shop-local@1',
					request: { objective: plan.objective, context: { sources: [plan.source] } },
				})
			for (const spec of specs()) explore(store, spec)
			merge(store, 'checkout', 'x-2', [
				['a1/Q1', 'b1/Q1'],
				['a2/Q2', 'b2/Q2'],
			])
			merge(store, 'basket', 'x-8', [
				['f1/Q1', 'g1/Q1', 'g1/Q4'],
				['f3/Q3', 'g3/Q3'],
			])
			minutesAgo(5 * day)
			harvestExploration(store, agent, { explorationId: 'x-7', observations: false })
			failed(store)
			paused(store)
			running(store)
			processRuns(store)
			coupons(store)
		})
	} finally {
		closeStore(store)
	}
}

function words(length: number, word = 'word') {
	return Array.from({ length: Math.ceil(length / (word.length + 1)) }, () => word)
		.join(' ')
		.slice(0, length)
}

export const hostile = [
	'<img src=x onerror="window.__xss=1">',
	'**bold** _it_ [link](javascript:window.__xss=2) `code` <script>window.__xss=3</script>',
	words(300, 'longtitle'),
	`Unbroken ${'A'.repeat(300)}`,
]

export function seedEdges(workspace: string) {
	seedVolume(workspace)
	const store = openStore(workspace)
	try {
		withDemoClock(() => {
			minutesAgo(3 * day)
			openPlan(store, agent, {
				planId: 'empty0',
				target: 'shop-local@1',
				request: { objective: 'A plan with no rules and no items.', context: { sources: ['ticket://E-0'] } },
			})
			openPlan(store, agent, {
				planId: 'odd1',
				target: 'shop-local@1',
				request: {
					objective: `Long and hostile content. ${words(300)}`,
					context: { sources: ['ticket://ODD-1'] },
					requirements: [
						{
							id: 'R1',
							text: `The only rule. ${words(200)}`,
							source: 'ticket://ODD-1',
							area: 'Area label with exactly forty characters',
						},
					],
				},
			})
			for (let build = 1; build <= 9; build++) {
				const explorationId = `o-${build}`
				minutesAgo((10 - build) * 12 * 60)
				openExploration(store, 'checkmate', {
					planId: 'odd1',
					build: `fixture-build-${build}`,
					explorationId,
					instance: 'local',
				})
				event(store, explorationId, { step: 'start', detail: { ...launch, explorers: 1 } })
				event(store, explorationId, { step: 'supervisor', detail: { pid: process.pid } })
				launched(store, explorationId, 'z1')
				const list: unknown[] =
					build === 1
						? hostile.map((title, index) => ({
								kind: 'defect',
								id: `D${index + 1}`,
								title,
								rule: 'R1',
								severity: 'high',
								expected: title,
								actual: title,
								steps: [title],
								suspected: true,
							}))
						: []
				list.push({
					kind: 'question',
					id: `Q${build}`,
					rule: 'R1',
					question: build === 1 ? `${hostile[0]} ${words(300)}` : `Question ${build}?`,
					...(build % 2 ? { blocking: true } : {}),
				})
				ended(store, explorationId, 'z1', list)
				done(store, explorationId)
			}
			answerGap(store, human, {
				planId: 'odd1',
				gapId: 'z1/Q2',
				kind: 'accept_assumption',
				value: words(5000),
				rationale: `Because ${words(600)}`,
			})
		})
	} finally {
		closeStore(store)
	}
}

const usage = 'Usage: node scripts/ui-volume.ts [--seed <workspace>] [--edges]'

if (import.meta.main) {
	const index = process.argv.indexOf('--seed')
	if (index > -1) {
		const target = process.argv[index + 1]
		if (!target) {
			console.error(usage)
			process.exit(1)
		}
		;(process.argv.includes('--edges') ? seedEdges : seedVolume)(resolve(target))
		console.log(`Seeded ${resolve(target)}`)
	} else {
		const workspace = mkdtempSync(join(tmpdir(), 'checkmate-ui-volume-'))
		;(process.argv.includes('--edges') ? seedEdges : seedVolume)(workspace)
		const ui = await startUi({ workspace, defaultActor: human })
		console.log(`Checkmate UI on the volume seed: ${ui.url}`)
		console.log('Press Ctrl+C to stop. The workspace is removed on stop.')
		const stopUi = async () => {
			await ui.close()
			process.exit(0)
		}
		process.on('exit', () => rmSync(workspace, { recursive: true, force: true }))
		process.on('SIGINT', stopUi)
		process.on('SIGTERM', stopUi)
	}
}
