import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const seed = JSON.parse(readFileSync(process.env.FACTORY_SEED, 'utf8'))
const server = createServer((request, response) => {
	if (request.url === '/health') {
		response.writeHead(200, { 'content-type': 'application/json' })
		return response.end(JSON.stringify({ build: process.env.FACTORY_BUILD, seeded: seed.seeded }))
	}
	if (request.url === '/quote') {
		response.writeHead(200, { 'content-type': 'application/json' })
		return response.end(
			JSON.stringify({ totalPLN: seed.basePLN + seed.loyaltyPLN + (process.env.FACTORY_BUG === '1' ? -20 : 0) })
		)
	}
	response.writeHead(404)
	response.end()
})

server.listen(0, '127.0.0.1', () => {
	const address = server.address()
	process.stdout.write(`READY http://127.0.0.1:${address.port}\n`)
})
