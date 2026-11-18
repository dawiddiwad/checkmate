import type { Page, Route } from 'playwright-core'

type Counted = { refreshed: number }

export async function watchRefreshes(page: Page) {
	const held: Route[] = []
	let holding = false
	let arrival = () => {}
	await page.addInitScript(() => {
		const counted = window as unknown as Counted
		counted.refreshed = 0
		const read = Response.prototype.text
		Response.prototype.text = async function () {
			const body = await read.call(this)
			setTimeout(() => (counted.refreshed += 1))
			return body
		}
	})
	await page.route('**/*', (route) => {
		const request = route.request()
		if (!holding || request.resourceType() !== 'fetch' || request.method() !== 'GET') return route.continue()
		held.push(route)
		arrival()
	})
	return {
		hold() {
			holding = true
		},
		arrived() {
			return held.length ? Promise.resolve() : new Promise<void>((resolve) => (arrival = resolve))
		},
		async release() {
			holding = false
			const routes = held.splice(0)
			const before = await page.evaluate(() => (window as unknown as Counted).refreshed)
			await Promise.all(routes.map((route) => route.continue()))
			await page.waitForFunction(
				(wanted) => (window as unknown as Counted).refreshed >= wanted,
				before + routes.length
			)
		},
	}
}
