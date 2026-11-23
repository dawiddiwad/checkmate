import { createServer } from 'node:http'

// The demo shop keeps no records. Its SPRING40 code is wrong on purpose: it gives 30 percent, not 40.
const price = 400
const percent = { SPRING40: 30 }
const refundDays = 14

export function quote(code) {
	const discount = percent[code] ?? 0
	const totalPLN = price - (price * discount) / 100
	return { itemPLN: price, code: code || null, discountPercent: discount, totalPLN }
}

export function refund(daysSinceDelivery) {
	return { daysSinceDelivery, eligible: daysSinceDelivery <= refundDays }
}

export function serve(port) {
	const server = createServer((request, response) => {
		const url = new URL(request.url, 'http://127.0.0.1')
		const json = (body) => {
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify(body))
		}
		if (url.pathname === '/quote') return json(quote(url.searchParams.get('code')))
		if (url.pathname === '/refund') return json(refund(Number(url.searchParams.get('daysSinceDelivery'))))
		response.writeHead(404, { 'content-type': 'text/plain' })
		response.end('not found')
	})
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const port = Number(process.argv[2] ?? 4173)
	await serve(port)
	console.log(`shop listening on http://127.0.0.1:${port}`)
}
