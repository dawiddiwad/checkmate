import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.ts'
import type {
	ExecuteRequest,
	Plan,
	PlanRequest,
	Profile,
	Response,
	Result,
	ReviseRequest,
} from '../plugin/src/types.ts'
import { sandbox, fixtureJson, root, write, artifact, load, claudeSession } from './support.ts'
import { delegate } from '../plugin/src/launcher.ts'
import { gate } from '../plugin/src/stages.ts'
import { readDocument } from '../plugin/src/files.ts'

// CHECKMATE_LIVE_HOST selects the worker host. The host keeps its own login and model.
const host = process.env.CHECKMATE_LIVE_HOST ?? 'claude'
const hostOptions: Record<string, { allowedTools: string[]; unrestrictedHost?: boolean }> = {
	claude: { allowedTools: ['Read', 'Write', 'Edit', 'Bash'] },
	codex: { allowedTools: ['workspace-write', 'network'] },
	pi: { allowedTools: ['read', 'write', 'edit', 'bash'], unrestrictedHost: true },
}
assert(hostOptions[host], `Unknown CHECKMATE_LIVE_HOST: ${host}`)
if (host === 'claude') {
	assert(
		process.env.CLAUDE_CODE_OAUTH_TOKEN ||
			process.env.ANTHROPIC_API_KEY ||
			process.env.CHECKMATE_USE_HOST_LOGIN === '1',
		'Configure Claude authentication before live tests'
	)
	process.env.CLAUDE_CONFIG_DIR ??= '/tmp/checkmate-live-claude'
	// The host selects the model. Development runs use Sonnet to limit usage.
	process.env.ANTHROPIC_MODEL ??= 'sonnet'
} else {
	assert(
		process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.CHECKMATE_USE_HOST_LOGIN === '1',
		`Configure ${host} authentication before live tests`
	)
	// codex exec reads an API key from CODEX_API_KEY. pi reads OPENAI_API_KEY.
	if (host === 'codex' && process.env.OPENAI_API_KEY) process.env.CODEX_API_KEY ??= process.env.OPENAI_API_KEY
}
process.env.PATH = `${join(root, 'node_modules/.bin')}:${process.env.PATH}`
const workspace = await sandbox()
// The Codex sandbox permits writes only in the workspace. Playwright CLI keeps its daemon state in the cache directory.
if (host === 'codex') process.env.XDG_CACHE_HOME = join(workspace, '.cache')
const app = await fixture()
const measurements: Array<{ stage: string; durationMs: number; status: Response['status'] }> = []
console.log(`Live artifacts: ${workspace}`)
console.log(`Live host: ${host}`)
const options = { ...hostOptions[host], host, timeoutSeconds: 240 }
async function stage<T>(name: string, request: unknown): Promise<{ response: Response; value: T }> {
	const path = `${name}.json`
	await write(workspace, path, request)
	const started = Date.now()
	const result = await delegate(workspace, path, options)
	measurements.push({ stage: name, durationMs: Date.now() - started, status: result.status })
	console.log(JSON.stringify(measurements.at(-1)))
	assert(result.artifact, JSON.stringify(result))
	assert(!['operational_error', 'interrupted', 'invalid_request'].includes(result.status), JSON.stringify(result))
	return { response: result, value: await load<T>(workspace, artifact(result)) }
}
try {
	await mkdir(join(workspace, '.playwright'), { recursive: true })
	await writeFile(
		join(workspace, '.playwright/cli.config.json'),
		JSON.stringify({
			browser: {
				browserName: 'chromium',
				launchOptions: {
					executablePath: process.env.CHECKMATE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
					headless: true,
				},
			},
		})
	)
	await writeFile(
		join(workspace, 'AGENTS.md'),
		'# Fixture workspace\n\nUse the running fixture. Do not change its code. The browser config is `.playwright/cli.config.json`. Use one isolated session per run. Use `open --idle-timeout=30000`. The checkout button creates a 400 PLN order. The page has no promotion or loyalty control. Check promotion and loyalty totals only through the quote endpoint with the http capability: GET /quote?promotion=true, optionally with &loyalty=true. The health endpoint is GET /health. Read /health for setup. Do not use /order or /quote during setup or planning. The caller owns the fixture server. No record cleanup is required. Browser sessions must be closed.\n'
	)
	const setupRequest = {
		contractVersion: 'toolkit-2',
		requestId: 'live-setup',
		operation: 'setup',
		caller: 'acceptance-test',
		targetId: 'checkout-local',
		baseUrl: app.baseUrl,
		capabilities: ['browser', 'http'],
		allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		profilePath: 'profile.json',
	}
	const configured = await stage<Profile>('setup', setupRequest)
	assert.equal(configured.value.readyForLiveExecution, true)
	const planRequest = await fixtureJson<PlanRequest>('plan-request')
	planRequest.target = artifact(configured.response)
	const planned = await stage<Plan>('plan', planRequest)
	assert.equal(app.actions(), 0, 'Planning executed a test action')
	// The unknown stacking and refund rules must block at least one test of R2 and of R3.
	for (const requirement of ['R2', 'R3'])
		assert(
			planned.value.tests.some(
				(test) => test.requirementIds.includes(requirement) && test.readiness === 'blocked'
			),
			`No ${requirement} test is blocked`
		)
	const selected = planned.value.tests.filter((t) => t.requirementIds.includes('R1')).map((t) => t.id)
	const initial: ExecuteRequest = {
		contractVersion: 'toolkit-2',
		requestId: 'live-partial',
		operation: 'execute',
		caller: 'acceptance-test',
		runId: 'live-partial',
		plan: artifact(planned.response),
		target: artifact(configured.response),
		selectedTestIds: selected,
		partialExecution: 'wait_for_resolution',
		timeoutSeconds: 240,
		onNewBlocker: 'return_to_caller',
		applicationBuild: 'fixture-build-1',
		outputDirectory: 'runs/live-partial',
	}
	assert.equal((await gate(workspace, initial)).status, 'needs_decision')
	await stage<Result>('partial', { ...initial, partialExecution: 'ready_only' })
	const templates = await fixtureJson<ReviseRequest['decisions']>('decisions')
	const decisions = planned.value.gaps
		.filter((gap) => gap.status === 'open' && gap.severity === 'blocking')
		.map((gap, i) => {
			// A gap names its requirement, or names tests that cover one requirement.
			const scope = new Set([
				...gap.requirementIds,
				...planned.value.tests
					.filter((test) => gap.testIds.includes(test.id))
					.flatMap((test) => test.requirementIds),
			])
			const [requirement] = scope
			assert(scope.size === 1 && ['R2', 'R3'].includes(requirement), 'Unexpected blocker needs a caller decision')
			const decision = templates[requirement === 'R2' ? 0 : 1]
			return { ...decision, id: `D${i + 1}`, gapId: gap.id }
		})
	const revised = await stage<Plan>('revise', {
		contractVersion: 'toolkit-2',
		requestId: 'live-revise',
		operation: 'revise',
		caller: 'acceptance-test',
		basePlan: artifact(planned.response),
		baseRevision: 1,
		decisions,
	})
	const ready = revised.value.tests.filter((t) => t.readiness === 'ready').map((t) => t.id)
	const execute = {
		...initial,
		requestId: 'live-execute',
		runId: 'live-run',
		outputDirectory: 'runs/live-run',
		plan: artifact(revised.response),
		selectedTestIds: ready,
	}
	const failed = await stage<Result>('execute', execute)
	assert.equal(failed.value.host.name, host)
	assert.equal(failed.value.host.source, 'launcher')
	console.log(`Host record: ${JSON.stringify(failed.value.host)}`)
	assert(failed.value.findings.some((f) => f.type === 'defect' && f.requirementIds.includes('R2')))
	assert.equal(failed.value.coverage.status, 'partial')
	app.fix()
	const retest = await stage<Result>('retest', {
		...execute,
		requestId: 'live-retest',
		runId: 'live-retest',
		outputDirectory: 'runs/live-retest',
		applicationBuild: 'fixture-build-2',
		retestOf: artifact(failed.response),
		selectedTestIds: revised.value.tests.filter((t) => t.requirementIds.includes('R2')).map((t) => t.id),
	})
	assert(
		retest.value.tests
			.filter((t) => retest.value.selectedTestIds.includes(t.testId))
			.every((t) => t.outcome === 'passed')
	)
	assert.equal(retest.value.coverage.status, 'partial')
	assert((await load<Result>(workspace, artifact(failed.response))).findings.some((f) => f.type === 'defect'))
	// A skill in the agent's own session. Only Claude has this check.
	if (host === 'claude') {
		const sameRequest = {
			...planRequest,
			requestId: 'same-session-plan',
			outputPlanId: 'same-session',
			planDirectory: 'plans/same-session',
		}
		await write(workspace, 'same-session.json', sameRequest)
		const same = await claudeSession(['--allowedTools', 'Read,Write,Edit,Bash'], {
			cwd: workspace,
			timeoutSeconds: 240,
			prompt: 'Use checkmate:checkmate-plan in this session with same-session.json. This is not a delegated candidate task. Publish the plan with the Checkmate CLI and return its response. Do not execute tests.',
		})
		assert.equal((await load<Plan>(workspace, artifact(same))).revision, 1)
		await readDocument(workspace, 'plans/same-session/v1.json')
	}
	assert((await readFile(join(workspace, 'runs/live-run/report.html'), 'utf8')).includes('Test result'))
	console.log(
		`Live acceptance passed on ${host}: setup, gaps, partial execution, revision, defect, retest${host === 'claude' ? ', and same-session planning' : ''}.`
	)
} finally {
	await app.close()
	await writeFile(join(workspace, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n')
}
