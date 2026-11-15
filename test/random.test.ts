import test from 'node:test'
import assert from 'node:assert/strict'
import type { Store } from '../plugin/src/store.ts'
import { approvePlan, patchPlan, planRevision } from '../plugin/src/plans.ts'
import {
	acceptResult,
	beginRun,
	closeTest,
	finishRun,
	recordFinding,
	rejectResult,
	runState,
} from '../plugin/src/runs.ts'
import { addInstance, instanceList, retireInstance } from '../plugin/src/targets.ts'
import { planStatus } from '../plugin/src/views.ts'
import { actor, approved, candidate, check, plan, revised, store, target } from './support.ts'

function random(seed: number) {
	let value = seed
	const next = (count: number) => {
		value = (value * 1103515245 + 12345) % 2147483648
		return value % count
	}
	return { next, pick: <T>(items: T[]) => items[next(items.length)] }
}

function record(opened: Store, runId: string, outcome: () => string, completion = 'completed') {
	const run = runState(opened, runId)
	for (const test of run.plan.tests.filter((item) => run.request.selectedTestIds.includes(item.id))) {
		const result = outcome() as 'passed' | 'failed' | 'inconclusive'
		test.assertions.forEach((assertion, i) => {
			const last = i === test.assertions.length - 1
			const reply = check(opened, runId, `${test.id}.${assertion.id}`, last ? result : 'passed')
			if (last && result === 'failed')
				recordFinding(opened, actor, {
					runId,
					finding: {
						id: `F-${test.id}`,
						type: 'defect',
						severity: 'high',
						assertionIds: [`${test.id}.${assertion.id}`],
						requirementIds: [test.requirementIds[0]],
						title: 'Broken.',
						expected: 'Pass.',
						observed: 'Fail.',
						reproduction: ['Run it.'],
						evidenceIds: reply.data.evidenceIds as string[],
					},
				})
		})
		closeTest(opened, actor, { runId, testId: test.id })
	}
	finishRun(opened, actor, {
		runId,
		completion,
		...(completion === 'interrupted' ? { cause: 'host_stopped', reason: 'The host stopped the session.' } : {}),
		cleanup: 'completed',
		cleanupReason: 'Closed.',
	})
}

function active(opened: Store) {
	return instanceList(opened, 'checkout-local')
		.filter((instance) => !instance.retired)
		.map((instance) => instance.instanceId)
}

function randomStep(opened: Store, draw: ReturnType<typeof random>, counter: { runs: number; instances: number }) {
	const revision = planRevision(opened, 'checkout').plan.revision
	const reference = `checkout@${revision}`
	const kind = draw.next(10)
	const someRun = () => `r${1 + draw.next(Math.max(counter.runs, 1))}`
	try {
		if (kind < 5) {
			const runId = `r${++counter.runs}`
			const retestOf = draw.next(4) === 0 && counter.runs > 1 ? `r${1 + draw.next(counter.runs - 1)}` : undefined
			const selection = draw.next(3) === 0 ? { tests: [draw.pick(['T1', 'T2'])] } : { partial: 'ready_only' }
			const reply = beginRun(opened, actor, {
				runId,
				reference,
				build: `b${1 + draw.next(3)}`,
				instance: draw.pick(active(opened)),
				retestOf,
				...selection,
			})
			if (reply.status !== 'completed') return
			const completion = draw.next(5) === 0 ? 'interrupted' : 'completed'
			record(opened, runId, () => draw.pick(['passed', 'passed', 'failed', 'inconclusive']), completion)
		} else if (kind === 5) rejectResult(opened, actor, { runId: someRun(), rationale: 'Wrong.' })
		else if (kind === 6) acceptResult(opened, actor, { runId: someRun(), rationale: 'Right.' })
		else if (kind === 7) {
			const instanceId = `i${++counter.instances}`
			addInstance(opened, actor, {
				targetId: 'checkout-local',
				instanceId,
				instance: { entries: { web: `https://${instanceId}.example.com` } },
			})
		} else if (kind === 8) {
			const instances = active(opened)
			if (instances.length > 1)
				retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: draw.pick(instances) })
		} else {
			const patch = draw.next(2)
				? { tests: { T1: { title: `Title ${draw.next(99)}` } } }
				: {
						tests: {
							T2: {
								assertions: {
									[`A${2 + draw.next(5)}`]: {
										check: `Check ${draw.next(9)}.`,
										checkKind: 'deterministic',
									},
								},
							},
						},
					}
			patchPlan(opened, actor, { reference, patch })
			const latest = planRevision(opened, 'checkout').plan.revision
			approvePlan(opened, actor, { reference: `checkout@${latest}`, rationale: 'Ok.' })
		}
	} catch {
		return
	}
}

function option(words: string[], name: string) {
	const index = words.indexOf(name)
	return index < 0 ? undefined : words[index + 1]
}

function followToEnd(opened: Store, counter: { runs: number }) {
	const seen = new Set<string>()
	for (let step = 0; step < 12; step++) {
		const status = planStatus(opened, 'checkout')
		if (status.state === 'accepted' || status.state === 'passed') return
		const shape = JSON.stringify([status.state, status.why, status.openRuns.map((run) => run.runId)])
		assert(!seen.has(shape), `The hints go in a cycle: ${shape}`)
		seen.add(shape)
		assert(status.next.length, `No next hint in ${shape}`)
		for (const hint of status.next) {
			const words = hint.replace(/^Build a fix, then /, '').split(' ')
			if (words[1] === 'result') {
				acceptResult(opened, actor, { runId: words[3], rationale: 'Right.' })
				continue
			}
			assert.equal(words[1], 'run', `Unexpected hint in ${shape}: ${hint}`)
			let build = option(words, '--build')!
			if (build.startsWith('<')) build = `n${step}`
			let instanceId = option(words, '--instance')
			if (instanceId === '<instanceId>') instanceId = active(opened)[0]
			const runId = `h${++counter.runs}`
			const reply = beginRun(opened, actor, {
				runId,
				reference: words[4],
				build,
				instance: instanceId,
				partial: 'ready_only',
				retestOf: option(words, '--retest-of'),
			})
			assert.equal(reply.status, 'completed', `${hint}: ${reply.reasons.join('; ')}`)
			record(opened, runId, () => 'passed')
		}
	}
	assert.fail(`The plan did not finish: ${planStatus(opened, 'checkout').state}`)
}

test('random records always reach the end of the loop by following the hints', (t) => {
	for (let seed = 1; seed <= 50; seed++) {
		const opened = store(t)
		target(opened)
		const value = candidate()
		value.tests[1].dependsOn = []
		plan(opened, 'checkout', value)
		revised(opened)
		approved(opened)
		const draw = random(seed * 7919)
		const counter = { runs: 0, instances: 0 }
		for (let i = 0; i < 8; i++) randomStep(opened, draw, counter)
		followToEnd(opened, counter)
	}
})
