import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { answerGap, openPlan } from '../plugin/src/plans.ts'
import { followCount } from '../plugin/src/explorers.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { actor, directory, plan, planRequest, root, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import { call, token } from './actions.ts'
import { done, entries, openTest } from './explorations.ts'

test('CLI and review page share same-build follow recommendations and retain safe recovery after refusal', async (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	openTest(opened, 'checkout', 'x-1', 'b1')
	entries(opened, 'x-1', 'a1', [{ kind: 'question', id: 'Q1', question: 'What is the limit?' }])
	done(opened, 'x-1')
	openTest(opened, 'checkout', 'x-2', 'b1')
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'a1/Q1',
		kind: 'clarify',
		value: 'Ten.',
		source: 'owner',
		rationale: 'Owner answer.',
	})
	done(opened, 'x-2')
	assert.equal(followCount(opened, 'x-1'), 1)
	assert.equal(followCount(opened, 'x-2'), 0)
	closeStore(opened)
	const fake = fakeClaude(t, {}, 'pi')
	const env = { ...process.env, ...fake.env, CHECKMATE_HARNESS: 'pi' }
	const ui = await startUi({ workspace, env, defaultActor: actor })
	t.after(() => ui.close())
	const readCli = (planId = 'checkout') =>
		JSON.parse(
			execFileSync(
				process.execPath,
				[join(root, 'plugin/dist/checkmate.js'), 'status', planId, '--workspace', workspace, '--json'],
				{ encoding: 'utf8', env }
			)
		)
	const readPage = async (planId = 'checkout') => {
		const response = await call(ui, `/plans/${planId}`)
		assert.equal(response.status, 200)
		const encoded = /data-qa-status="([^"]+)"/.exec(response.body)![1]
		const decoded = encoded
			.replaceAll('&quot;', '"')
			.replaceAll('&#39;', "'")
			.replaceAll('&lt;', '<')
			.replaceAll('&gt;', '>')
			.replaceAll('&amp;', '&')
		return { body: response.body, qa: JSON.parse(decoded) }
	}
	const cli = readCli()
	const page = await readPage()
	assert.deepEqual(page.qa, cli.qa)
	assert.equal(cli.qa.build, 'b1')
	assert.equal(cli.qa.state, cli.state)
	assert.equal(cli.qa.waitsOn, cli.waitsOn)
	assert.match(cli.next[0], /1 unused answer of x-1/)
	assert.match(page.body, /Test the answers \(1\)/)
	assert.match(page.body, /name="exploration" value="x-1"/)
	assert.deepEqual(
		cli.qa.follow.map(
			(item: { explorationId: string; eligible: boolean; recommended: boolean; available: boolean }) => [
				item.explorationId,
				item.eligible,
				item.recommended,
				item.available,
			]
		),
		[
			['x-1', true, true, true],
			['x-2', false, false, false],
		]
	)
	assert.deepEqual(cli.qa.actions[0], { kind: 'follow', ...cli.qa.follow[0] })
	const refused = await call(
		ui,
		'/plans/checkout/follow',
		{ csrf: token(page.body), exploration: 'x-2' },
		{ Cookie: `checkmate_actor=${actor}` }
	)
	assert.equal(refused.status, 422)
	assert.match(refused.body, /no answer that a follow-up has not used/i)
	const after = await readPage()
	assert.deepEqual(after.qa, readCli().qa)
	assert.deepEqual(after.qa, page.qa)
	assert.match(after.body, /name="exploration" value="x-1"/)
	const reopened = openStore(workspace)
	assert.equal(
		reopened.db
			.prepare("SELECT count(*) AS n FROM operations WHERE command = 'explore follow' AND status = 'rejected'")
			.get()!.n,
		1
	)
	openTest(reopened, 'checkout', 'x-3', 'b1')
	entries(reopened, 'x-3', 'a2', [{ kind: 'question', id: 'Q2', question: 'Who can approve?', blocking: true }])
	done(reopened, 'x-3')
	closeStore(reopened)
	const blocked = readCli()
	const blockedPage = await readPage()
	assert.deepEqual(blockedPage.qa, blocked.qa)
	assert.equal(blocked.qa.build, 'b1')
	assert.equal(blocked.qa.waitsOn, 'oracle')
	assert.ok(
		blocked.qa.blockers.some(
			(item: { kind: string; text: string }) => item.kind === 'question' && item.text === 'Who can approve?'
		)
	)
	const other = openStore(workspace)
	openTest(other, 'checkout', 'x-4', 'b2')
	done(other, 'x-4')
	openTest(other, 'checkout', 'x-5', 'b1')
	closeStore(other)
	const running = readCli()
	const runningPage = await readPage()
	assert.deepEqual(runningPage.qa, running.qa)
	assert.deepEqual([running.qa.build, running.qa.activeBuild], ['b2', 'b1'])
	assert.match(runningPage.body, /Build b1 is under test now/)
	const nextStore = openStore(workspace)
	plan(nextStore, 'other')
	answerGap(nextStore, actor, {
		planId: 'other',
		gapId: 'G1',
		kind: 'clarify',
		value: 'Replaces loyalty.',
		source: 'owner',
		rationale: 'Owner answer.',
	})
	closeStore(nextStore)
	const piStatus = readCli('other')
	const piPage = await readPage('other')
	assert.deepEqual(piPage.qa, piStatus.qa)
	assert.equal(piStatus.state, 'needs_revision')
	assert.match(piStatus.qa.actions[0].text, /checkmate delegate revise other$/)
	assert.ok(piStatus.qa.blockers.some((item: { kind: string }) => item.kind === 'decision'))
})
