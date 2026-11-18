import type { Page, Route } from 'playwright-core'

export async function watchRefreshes(page: Page) {
	const held: Route[] = []
	let holding = false
	let arrival = () => {}
	let read = 0
	let replaced = 0
	let reading: Array<{ count: number; done: () => void }> = []
	await page.addInitScript(() => {
		const text = Response.prototype.text
		Response.prototype.text = async function () {
			const body = await text.call(this)
			setTimeout(() => console.log('refresh-read'))
			return body
		}
		new MutationObserver((list) => {
			const gone = list.some((one) =>
				[...one.removedNodes].some((node) => node instanceof Element && node.matches('[data-region]'))
			)
			if (gone) console.log('region-replaced')
		}).observe(document, { subtree: true, childList: true })
	})
	page.on('console', (message) => {
		if (message.text() === 'region-replaced') replaced += 1
		if (message.text() !== 'refresh-read') return
		read += 1
		for (const each of reading.filter((one) => one.count <= read)) each.done()
		reading = reading.filter((one) => one.count > read)
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
		replaced: () => replaced,
		async release() {
			holding = false
			const routes = held.splice(0)
			const count = read + routes.length
			const answered = new Promise<void>((done) => reading.push({ count, done }))
			await Promise.all(routes.map((route) => route.continue()))
			await answered
		},
	}
}
