import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'

export async function fixture() {
	let fixed = false
	let actions = 0
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://fixture')
		response.setHeader('Content-Type', 'application/json')
		if (url.pathname === '/health') return response.end(JSON.stringify({ ready: true }))
		if (url.pathname === '/quote') {
			actions++
			// The seeded defect: the promotion stacks with loyalty until the factory fixes it.
			const promotion = url.searchParams.get('promotion') === 'true'
			const loyalty = url.searchParams.get('loyalty') === 'true'
			const totalPLN = promotion ? (loyalty && !fixed ? 220 : 240) : 400
			return response.end(JSON.stringify({ totalPLN }))
		}
		if (url.pathname === '/order' && request.method === 'POST') {
			actions++
			return response.end(JSON.stringify({ totalPLN: 400, status: 'confirmed' }))
		}
		if (url.pathname === '/') {
			response.setHeader('Content-Type', 'text/html')
			return response.end(
				'<!doctype html><html lang="en"><title>Checkout fixture</title><h1>Checkout</h1><p>One item: 400 PLN</p><button id="checkout">Complete checkout</button><p id="confirmation"></p><script>document.querySelector("button").onclick=async()=>{const result=await(await fetch("/order",{method:"POST"})).json();document.querySelector("#confirmation").textContent=`Order confirmed: ${result.totalPLN} PLN`}</script></html>'
			)
		}
		response.statusCode = 404
		response.end(JSON.stringify({ error: 'not_found' }))
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	return {
		baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		fix() {
			fixed = true
		},
		actions() {
			return actions
		},
		async close() {
			server.closeAllConnections()
			await new Promise((resolve) => server.close(resolve))
		},
	}
}
