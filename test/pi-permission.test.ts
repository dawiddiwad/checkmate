import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
// @ts-expect-error Pi loads this JavaScript extension directly.
import permission from '../plugin/pi/permission.mjs'

test('Pi tool permission requires an explicit allow from the UI', async () => {
	let handler: (event: unknown, context: unknown) => Promise<unknown> = async () => undefined
	permission({ registerCommand: () => {}, on: (_name: string, fn: typeof handler) => (handler = fn) })
	const responses = ['', JSON.stringify({ hookSpecificOutput: { decision: { behavior: 'allow' } } }), '']
	const paths: string[] = []
	const server = createServer((request, response) => {
		paths.push(request.url ?? '')
		response.end(responses.shift())
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	const previous = process.env.CHECKMATE_PI_HOOK
	process.env.CHECKMATE_PI_HOOK = JSON.stringify({
		port: address.port,
		token: 'secret',
		explorationId: 'request',
		who: 'R1',
	})
	try {
		const event = { toolName: 'read', input: { path: 'a' } }
		assert.equal(await handler(event, { cwd: '/w' }), undefined)
		assert.deepEqual(await handler(event, { cwd: '/w' }), {
			block: true,
			reason: 'Checkmate could not get permission for this tool.',
		})
		assert.deepEqual(paths, [
			'/hooks/activity/request/R1',
			'/hooks/permission/request/R1',
			'/hooks/activity/request/R1',
			'/hooks/permission/request/R1',
		])
	} finally {
		if (previous === undefined) delete process.env.CHECKMATE_PI_HOOK
		else process.env.CHECKMATE_PI_HOOK = previous
		server.close()
	}
})
