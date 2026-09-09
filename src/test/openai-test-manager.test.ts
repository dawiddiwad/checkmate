import { describe, expect, it, vi } from 'vitest'
import { runnerFixture, emptySession } from './runtime/runner-fixture'
import { ScenarioControl } from '../runtime/scenario-control'

describe('CheckmateRunner initialization', () => {
	it('sends system, intent, and initial driver context before the first model request', async () => {
		const send = vi.fn().mockRejectedValue(new Error('API Error'))
		const session = emptySession()
		session.buildInitialContext = async () => [{ content: 'initial state', ephemeral: true }]
		const runner = runnerFixture(session, { aiClient: { send } as never })
		const scenario = new ScenarioControl({ timeoutMs: 5000 })
		try {
			const report = await runner.run(
				{ id: 'submit', action: 'Click submit', expect: 'Submitted' },
				scenario.createStepControl(1000)
			)
			const messages = send.mock.calls[0][0]
			expect(messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user', 'user'])
			expect(JSON.stringify(messages[1])).toContain('Click submit')
			expect(JSON.stringify(messages[2])).toContain('initial state')
			expect(report).toMatchObject({ outcome: 'failed', category: 'infra', reason: 'provider-error' })
			expect(report.actual).toContain('API Error')
			await expect(runner.teardown()).resolves.toBeUndefined()
		} finally {
			scenario.dispose()
		}
	})
})
