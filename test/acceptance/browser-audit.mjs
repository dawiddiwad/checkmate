import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function browserAudit(installation) {
	const directory = await mkdtemp(resolve(installation, 'browser-audit-'))
	const records = resolve(directory, 'records.jsonl')
	const preload = resolve(directory, 'preload.mjs')
	await writeFile(records, '')
	await writeFile(
		preload,
		`
import http from 'node:http'
import { appendFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { localBrowser } from '@browserbasehq/stagehand'
const record = value => appendFileSync(${JSON.stringify(records)}, JSON.stringify(value) + '\\n')
const launch = localBrowser.launch.bind(localBrowser)
localBrowser.launch = async options => {
  const netlog = ${JSON.stringify(directory)} + '/netlog-' + process.pid + '.json'
  record({ netlog })
  const browser = await launch({ ...options, args: [...(options?.args ?? []), '--log-net-log=' + netlog] })
  const close = browser.close.bind(browser)
  browser.close = async () => {
    try {
      record({ beforeClose: await readFile(netlog, 'utf8'), netlogSnapshot: netlog })
    } finally {
      await close()
    }
  }
  return browser
}
const createServer = http.createServer
http.createServer = function (...args) {
  const server = createServer.apply(this, args)
  server.on('request', (request, response) => {
    if (request.url !== '/v1/traces') return
    const address = server.address()
    response.once('finish', () => record({ address: address.address, port: address.port, origin: request.headers.origin, status: response.statusCode }))
  })
  return server
}
syncBuiltinESMExports()
`
	)
	return {
		env: { NODE_OPTIONS: `--import=${preload}` },
		async verify() {
			const events = (await readFile(records, 'utf8'))
				.trim()
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line))
			const exports = events.filter((event) => event.port)
			assert(exports.length > 0, 'No real extension telemetry exports observed')
			assert(
				exports.every(
					(event) =>
						event.address === '127.0.0.1' &&
						event.status === 200 &&
						/^chrome-extension:\/\/[a-p]{32}$/.test(event.origin)
				)
			)
			const endpoints = [...new Set(exports.map((event) => `http://127.0.0.1:${event.port}/v1/traces`))]
			for (const endpoint of endpoints)
				await assert.rejects(globalThis.fetch(endpoint), 'Receiver remained open after execution')
			const logs = events.filter((event) => event.netlog)
			assert(logs.length > 0, 'No owned browser netlog recorded')
			for (const { netlog } of logs) {
				let urls = []
				for (let attempt = 0; attempt < 100; attempt++) {
					const text =
						events
							.filter((event) => event.netlogSnapshot === netlog)
							.map((event) => event.beforeClose)
							.join('\n') + (await readFile(netlog, 'utf8'))
					urls = [
						...new Set(
							[...text.matchAll(/"url":\s*("(?:[^"\\]|\\.)*")/g)].map((match) => JSON.parse(match[1]))
						),
					]
					if (urls.some((url) => endpoints.includes(url))) break
					await delay(100)
				}
				assert(
					urls.some((url) => endpoints.includes(url)),
					'Browser netlog did not contain local telemetry'
				)
				assert(
					urls.filter((url) => url.includes('/v1/traces')).every((url) => endpoints.includes(url)),
					'Unexpected external telemetry destination'
				)
				assert(!urls.some((url) => url.includes('example.com')), 'SDK default telemetry destination used')
			}
		},
	}
}
