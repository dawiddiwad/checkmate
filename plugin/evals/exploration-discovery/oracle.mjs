import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { buildSource, deploy } from './releases.mjs'

async function request(url, path, method = 'GET', body) {
	const response = await fetch(url + path, {
		method,
		...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
	})
	assert.equal(response.status, 200)
	return response.headers.get('content-type').startsWith('application/json') ? response.json() : response.text()
}

const booking = '/api/bookings/'
const interval = '&from=2027-04-03&to=2027-04-05'

export const cases = [
	[
		'D01',
		'Asset search does not trim whitespace',
		['lamp'],
		async (url) => (await request(url, '/api/assets?q=%20lamp%20')).map((row) => row.id),
	],
	[
		'D02',
		'Ridge quotes charge a deposit with annual coverage',
		0,
		async (url) => (await request(url, '/api/quote?asset=camera&coverage=annual' + interval)).depositCents,
	],
	[
		'D03',
		'A return date blocks the next pickup',
		1,
		async (url) => (await request(url, '/api/availability?asset=lamp&from=2027-04-05&to=2027-04-06')).available,
	],
	[
		'D04',
		'CSV fails to quote customer names that contain commas',
		true,
		async (url) =>
			(await request(url, '/api/export?status=cancelled')).includes('B102,"Pat Lee, Jr.",camera,ridge,cancelled'),
	],
	[
		'D05',
		'Returned booking history uses the wrong action name',
		'returned',
		async (url) => (await request(url, booking + 'B105/history')).at(-1).action,
	],
	[
		'D06',
		'Empty filtered desk leaves CSV download enabled',
		true,
		async (url, page) => {
			await page.goto(url + '/?depot=quay&status=checked-out')
			return page.locator('#export').isDisabled()
		},
	],
	[
		'R01',
		'Member discount reduces the weekend surcharge',
		5140,
		async (url) => (await request(url, '/api/quote?asset=screen&member=true' + interval)).rentalCents,
	],
	[
		'R02',
		'Ridge availability ignores checked-out bookings',
		0,
		async (url) => (await request(url, '/api/availability?asset=screen' + interval)).available,
	],
	[
		'R03',
		'Status pagination skips the second matching record',
		['B107'],
		async (url) =>
			(await request(url, '/api/bookings?depot=ridge&status=confirmed&page=2&size=1')).items.map((row) => row.id),
	],
	[
		'R04',
		'Single partner reschedule clears its pickup note',
		'Use the freight lift',
		async (url) => (await request(url, booking + 'B106', 'PATCH', { from: '2027-04-08', to: '2027-04-10' })).note,
	],
	[
		'R05',
		'Cancelling a prepaid reservation returns no deposit',
		2500,
		async (url) => (await request(url, booking + 'B107/cancel', 'POST')).refundCents,
	],
	[
		'R06',
		'CSV link in the desk loses the status filter',
		'confirmed',
		async (url, page) => {
			await page.goto(url + '/?depot=ridge&status=confirmed')
			return new URL(await page.locator('#export').getAttribute('href'), url).searchParams.get('status')
		},
	],
]

async function bulkControl(url, page) {
	await page.goto(url + '/')
	await page.getByRole('link', { name: 'Bulk reschedule' }).click()
	await page
		.getByLabel('Booking ID, pickup, return')
		.fill('B101, 2027-04-06, 2027-04-08\nB106, 2027-04-09, 2027-04-10')
	await page.getByRole('button', { name: 'Apply changes' }).click()
	await page.getByRole('status').getByText(/B106/).waitFor()
	assert.equal((await request(url, booking + 'B101')).from, '2027-04-06')
	assert.equal((await request(url, booking + 'B106')).from, '2027-04-09')
	const invalid = await fetch(url + '/api/bulk-reschedule', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ changes: [{ id: 'B101', from: '2027-04-08', to: '2027-04-10' }, { id: 'B000' }] }),
	})
	assert.equal(invalid.status, 422)
	assert.equal((await request(url, booking + 'B101')).from, '2027-04-06')
}

export async function verifyFixture() {
	const browser = await chromium.launch(
		process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }
	)
	const observations = new Map(cases.map(([id, title, expected]) => [id, { id, title, expected }]))
	try {
		const page = await browser.newPage()
		for (const [label, release, clean] of [
			['base', 'base', false],
			['pr', 'pr', false],
			['control', 'pr', true],
		]) {
			const app = await deploy(buildSource(release, clean))
			try {
				for (const [id, , expected, check] of cases) {
					const actual = await check(app.url, page)
					if (clean || (release === 'base' && id.startsWith('R')))
						assert.deepEqual(actual, expected, id + ' ' + label)
					else assert.notDeepEqual(actual, expected, id + ' ' + label)
					observations.get(id)[label] = actual
				}
				if (release === 'pr') await bulkControl(app.url, page)
			} finally {
				await app.close()
			}
		}
	} finally {
		await browser.close()
	}
	return [...observations.values()]
}
