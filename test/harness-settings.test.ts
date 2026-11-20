import assert from 'node:assert/strict'
import test from 'node:test'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { explorationStatus, launchPlan } from '../plugin/src/explorers.ts'
import { testLevels } from '../plugin/src/levels.ts'
import { closeStore, completed, openStore, write } from '../plugin/src/store.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { piModelArgs, selectedHarness } from '../plugin/src/pi.ts'
import {
	piRequestModelEnv,
	requestEffortText,
	requestModelText,
	saveModels,
	saveRequestModel,
	saveTesterRules,
	saveWorkspaceHarness,
	testerRulesText,
	testerEffortText,
	testerModelText,
	workspaceEnv,
	workspaceUiEnv,
} from '../plugin/src/settings.ts'
import { actor, directory, plan, profile, store, target } from './support.ts'
import { endProcessesIn, postAs, waitFor } from './actions.ts'
import { fakeClaude } from './claude.ts'

test('workspace harness overrides the UI default and leaves CLI environment overrides in force', (t) => {
	const opened = store(t)
	const startup = { CHECKMATE_HARNESS: 'pi' }
	assert.equal(selectedHarness(workspaceUiEnv(opened, startup)), 'pi')
	assert.equal(selectedHarness(workspaceUiEnv(opened, {})), 'claude')
	saveWorkspaceHarness(opened, actor, 'claude')
	assert.equal(selectedHarness(workspaceUiEnv(opened, startup)), 'claude')
	assert.equal(selectedHarness(workspaceEnv(opened, startup)), 'pi')
	saveWorkspaceHarness(opened, actor, 'pi')
	assert.equal(selectedHarness(workspaceEnv(opened, {})), 'pi')
	assert.throws(() => saveWorkspaceHarness(opened, actor, 'other'), /agent harness/)
})

test('tool rules and request model stay separate for each harness', (t) => {
	const opened = store(t)
	saveTesterRules(opened, actor, 'Read Bash(git status:*)')
	saveRequestModel(opened, actor, 'opus')
	saveTesterRules(opened, actor, 'Read Write', 'pi')
	saveRequestModel(opened, actor, 'openrouter/z-ai/glm-5.3-flash', 'pi')
	assert.equal(testerRulesText(opened), 'Read Bash(git status:*)')
	assert.equal(testerRulesText(opened, 'pi'), 'Read Write')
	assert.equal(requestModelText(opened), 'opus')
	assert.equal(requestModelText(opened, 'pi'), 'openrouter/z-ai/glm-5.3-flash')
	assert.throws(() => saveTesterRules(opened, actor, 'Bash(git status:*)', 'pi'), /tool name/)
})

test('tester model changes and clearing leave legacy request models alone', (t) => {
	const opened = store(t)
	saveRequestModel(opened, actor, 'legacy-request')
	saveRequestModel(opened, actor, 'provider/pi-request', 'pi')
	assert.equal(testerModelText(opened), '')
	assert.equal(testerModelText(opened, 'pi'), '')
	saveModels(opened, actor, 'claude', requestModelText(opened), 'sonnet')
	saveModels(opened, actor, 'pi', requestModelText(opened, 'pi'), 'openrouter/z-ai/glm-5.3-flash')
	saveModels(opened, actor, 'pi', requestModelText(opened, 'pi'), ' ')
	assert.equal(testerModelText(opened, 'pi'), '')
	assert.equal(testerModelText(opened), 'sonnet')
	assert.equal(requestModelText(opened), 'legacy-request')
	assert.equal(requestModelText(opened, 'pi'), 'provider/pi-request')

	const input = { planId: 'checkout', build: 'b1', allow: ['Read'], claudeArgs: [] }
	const piEnv = { CHECKMATE_HARNESS: 'pi' }
	assert.equal(launchPlan(profile(), input, piEnv, testerModelText(opened, 'pi')).model, null)
	const piExplicit = launchPlan(profile(), input, { ...piEnv, CHECKMATE_PI_MODEL: 'host' }, 'stored')
	assert.deepEqual([piExplicit.model, piExplicit.modelFrom], ['host', 'host'])
	const claudeExplicit = launchPlan(profile(), { ...input, claudeArgs: ['--model', 'host'] }, {}, 'stored')
	assert.deepEqual([claudeExplicit.model, claudeExplicit.modelFrom], ['host', 'host'])
	saveModels(opened, actor, 'claude', requestModelText(opened), '')
	assert.equal(launchPlan(profile(), input, {}, testerModelText(opened)).model, testLevels.normal.model)
})

test('individual model overrides fit the tester count and host', () => {
	const input = { planId: 'checkout', build: 'b1', allow: ['Read'], claudeArgs: [], level: 'smoke' }
	assert.throws(() => launchPlan(profile(), { ...input, testerModels: { a2: 'sonnet' } }, {}), /Unknown tester a2/)
	assert.throws(() => launchPlan(profile(), { ...input, testerModels: { a1: 'bad alias' } }, {}), /model alias/)
	assert.throws(
		() => launchPlan(profile(), { ...input, session: true, testerModels: { a1: 'sonnet' } }, {}),
		/new processes/
	)
})

test('Claude model choices accept full Bedrock inference-profile ARNs', (t) => {
	const opened = store(t)
	const arn =
		'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/company-claude-sonnet-inference-profile'
	saveModels(opened, actor, 'claude', arn, arn)
	assert.equal(requestModelText(opened), arn)
	assert.equal(testerModelText(opened), arn)
	assert.throws(() => saveRequestModel(opened, actor, `${arn};invalid`), /model alias/)
})

test('saving both models rejects invalid settings without changing either model', (t) => {
	const opened = store(t)
	saveModels(opened, actor, 'claude', 'request-old', 'tester-old')
	assert.throws(() => saveModels(opened, actor, 'claude', 'request-new', 'invalid tester'), /model alias/)
	assert.equal(requestModelText(opened), 'request-old')
	assert.equal(testerModelText(opened), 'tester-old')
	saveModels(opened, actor, 'claude', 'request-new', '')
	assert.equal(requestModelText(opened), 'request-new')
	assert.equal(testerModelText(opened), '')
})

test('workspace effort belongs to its harness and role', (t) => {
	const opened = store(t)
	saveModels(opened, actor, 'claude', 'sonnet', '', 'high', 'low')
	saveModels(opened, actor, 'pi', 'host/request', '', 'minimal', 'xhigh')
	assert.equal(requestEffortText(opened), 'high')
	assert.equal(testerEffortText(opened), 'low')
	assert.equal(requestEffortText(opened, 'pi'), 'minimal')
	assert.equal(testerEffortText(opened, 'pi'), 'xhigh')
	assert.throws(() => saveModels(opened, actor, 'claude', '', '', 'off', 'medium'), /reasoning effort/)
	assert.equal(requestModelText(opened), 'sonnet')
	assert.equal(testerEffortText(opened), 'low')
	saveModels(opened, actor, 'claude', 'opus', '')
	assert.equal(requestEffortText(opened), '')
	assert.equal(testerEffortText(opened), 'low')
})

test('legacy Pi IDs keep the configured provider and catalog IDs can change it', (t) => {
	const opened = store(t)
	const legacy = 'z-ai/glm-5.3-flash'
	write(
		opened,
		{ actor, command: 'setting set', subject: 'piRequestModel', input: { model: legacy } },
		(operationId) => {
			opened.db
				.prepare('INSERT INTO workspace_settings (name, value, operation_id) VALUES (?, ?, ?)')
				.run('piRequestModel', legacy, operationId)
			return { reply: completed('piRequestModel'), subjects: ['settings'] }
		}
	)
	const env = { CHECKMATE_PI_PROVIDER: 'openrouter', CHECKMATE_PI_MODEL: 'startup' }
	assert.equal(requestModelText(opened, 'pi'), legacy)
	assert.deepEqual(piModelArgs(piRequestModelEnv(opened, env)), ['--model', legacy, '--provider', 'openrouter'])
	saveModels(opened, actor, 'pi', legacy, 'custom/tester')
	assert.deepEqual(piModelArgs(piRequestModelEnv(opened, env)), ['--model', legacy, '--provider', 'openrouter'])
	const catalog = 'custom/vendor/model~preview'
	saveModels(opened, actor, 'pi', catalog, catalog)
	assert.equal(testerModelText(opened, 'pi'), catalog)
	assert.deepEqual(piModelArgs(piRequestModelEnv(opened, env)), ['--model', catalog])
	saveRequestModel(opened, actor, 'z-ai/next', 'pi')
	assert.deepEqual(piModelArgs(piRequestModelEnv(opened, env)), ['--model', 'z-ai/next', '--provider', 'openrouter'])
	saveRequestModel(opened, actor, '', 'pi')
	assert.deepEqual(piModelArgs(piRequestModelEnv(opened, env)), ['--model', 'startup', '--provider', 'openrouter'])
})

for (const harness of ['claude', 'pi'] as const) {
	test(`the ${harness} UI pins distinct tester models and keeps the run model for review`, async (t) => {
		const workspace = directory(t)
		const opened = store(t, workspace)
		target(opened, { explore: { explorers: 2 } })
		plan(opened)
		const selected = harness === 'pi' ? 'openrouter/z-ai/glm-5.3-flash' : 'sonnet'
		const overrides = harness === 'pi' ? ['provider/first', 'provider/second'] : ['opus', 'haiku']
		saveModels(opened, actor, harness, 'request-only', selected, undefined, 'low')
		closeStore(opened)
		const models = [selected, ...overrides].map((model) => {
			if (harness === 'claude') return { value: model, supportedEffortLevels: ['low', 'medium', 'high'] }
			const slash = model.indexOf('/')
			return { provider: model.slice(0, slash), id: model.slice(slash + 1), reasoning: true }
		})
		const fake = fakeClaude(
			t,
			{
				models,
				recorder: [{ kind: 'defect', title: 'Wrong tax', severity: 'high', expected: '0', actual: '23' }],
				verifier: [{ id: 'a1/D1', seen: true, saw: 'The tax is 23 again.' }],
			},
			harness
		)
		const ui = await startUi({
			workspace,
			env: {
				...fake.env,
				CHECKMATE_HARNESS: harness,
				CHECKMATE_PI_MODEL: 'startup-model',
				CHECKMATE_PI_PROVIDER: 'startup-provider',
			},
		})
		t.after(async () => {
			await ui.close()
			endProcessesIn(workspace)
		})
		const sent = await postAs(ui, actor, '/plans/checkout/test', {
			build: 'b1',
			level: 'normal',
			rules: 'Read Bash',
			'testerModel.a1': overrides[0],
			'testerModel.a2': overrides[1],
			'testerEffort.a1': 'high',
		})
		assert.equal(sent.status, 303, await sent.text())
		const id = sent.headers.get('location')!.split('/').at(-1)!
		const changed = openStore(workspace)
		saveModels(changed, actor, harness, requestModelText(changed, harness), '')
		closeStore(changed)
		await waitFor('exploration completes', () => {
			const reader = openStore(workspace)
			try {
				return explorationEvents(reader, id).some(
					(event) => event.step === 'done' && event.status === 'completed'
				)
			} finally {
				closeStore(reader)
			}
		})
		const calls = fake.called()
		const argument = (call: { args: string[] }, name: string) => call.args[call.args.indexOf(name) + 1]
		const effortFlag = harness === 'pi' ? '--thinking' : '--effort'
		for (const [index, model] of overrides.entries()) {
			const name = `a${index + 1}`
			const study = calls.find((call) => call.role === 'explorer' && call.work.endsWith(`/${name}`))
			assert.ok(study)
			const session = argument(study, '--session-id')
			const tester = calls.find(
				(call) =>
					call.role === 'tester' && argument(call, harness === 'pi' ? '--session' : '--resume') === session
			)
			const recorder = calls.find(
				(call) =>
					call.role === 'recorder' && argument(call, harness === 'pi' ? '--fork' : '--resume') === session
			)
			assert.ok(tester)
			assert.ok(recorder)
			for (const call of [study, tester, recorder]) {
				assert.equal(argument(call, '--model'), model)
				assert.equal(argument(call, effortFlag), index === 0 ? 'high' : 'medium')
				assert(!call.args.includes('--provider'))
			}
		}
		for (const role of ['merger', 'verifier']) {
			const call = calls.find((item) => item.role === role)
			assert.ok(call, `missing ${role}`)
			assert.equal(argument(call, '--model'), selected)
			assert.equal(argument(call, effortFlag), 'low')
		}
		const reader = openStore(workspace)
		try {
			assert.deepEqual(
				explorationStatus(reader, id).explorers.map((item) => item.model),
				overrides
			)
		} finally {
			closeStore(reader)
		}
	})
}
