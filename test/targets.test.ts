import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	addInstance,
	findInstance,
	instanceList,
	openTarget,
	retireInstance,
	saveTarget,
	showTarget,
	showTargetRequest,
	targetHistory,
	targetList,
	targetRevision,
} from '../plugin/src/targets.ts'
import { operationLog } from '../plugin/src/views.ts'
import { actor, cli, json, profile, store, target } from './support.ts'

const request = {
	targetId: 'checkout-local',
	entryPoints: profile().entryPoints,
	capabilities: ['browser', 'http'],
	allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
}

test('target open records the setup request once; an identical open is a no-op', (t) => {
	const opened = store(t)
	assert.equal(openTarget(opened, actor, request).data.recorded, true)
	assert.equal(openTarget(opened, actor, request).data.recorded, false)
	assert.throws(
		() => openTarget(opened, actor, { ...request, capabilities: ['http'] }),
		/Target checkout-local is open with other values/
	)
	assert.throws(() => openTarget(opened, actor, { ...request, targetId: 'bad id' }), /Invalid target ID: bad id/)
	assert.throws(() => openTarget(opened, actor, { ...request, entryPoints: [] }), /Missing entry points/)
	assert.throws(
		() =>
			openTarget(opened, actor, {
				...request,
				entryPoints: [{ name: 'web', kind: 'socket' as 'url', purpose: 'x' }],
			}),
		/Invalid kind of entry point web: socket/
	)
	assert.throws(
		() =>
			openTarget(opened, actor, {
				...request,
				entryPoints: [...request.entryPoints, ...request.entryPoints],
			}),
		/Duplicate entry point name/
	)
	assert.throws(
		() => openTarget(opened, actor, { ...request, entryPoints: [{ name: 'my web', kind: 'url', purpose: 'x' }] }),
		/Invalid entry point name: my web/
	)
	assert.throws(() => openTarget(opened, actor, { ...request, allowedOperations: [] }), /Missing operations/)
})

test('target save checks the profile against the setup request and the revision order', (t) => {
	const opened = store(t)
	assert.throws(
		() => saveTarget(opened, actor, { targetId: 'checkout-local', profile: profile() }),
		/Run target open/
	)
	openTarget(opened, actor, request)
	const save = (overrides: Parameters<typeof profile>[0]) =>
		saveTarget(opened, actor, { targetId: 'checkout-local', profile: profile(overrides) })
	assert.throws(
		() => save({ entryPoints: [{ name: 'api', kind: 'url', purpose: 'API.' }] }),
		/entryPoints differ from the setup request/
	)
	assert.throws(() => save({ capabilities: ['browser'] }), /capabilities differ/)
	assert.throws(() => save({ allowedOperations: ['read_catalog'] }), /allowedOperations differ/)
	assert.throws(() => save({ revision: 2 }), /Profile revision must be 1, not 2/)
	assert.throws(() => save({ contractVersion: 'toolkit-1' as 'toolkit-2' }), /Invalid profile/)
	assert.throws(
		() =>
			save({
				tools: [
					...profile().tools.slice(0, 1),
					{ name: 'node', kind: 'cli', purpose: 'HTTP.', version: 'unknown', reachable: true },
				],
			}),
		/actual version of node/
	)
	const first = save({ readyForLiveExecution: false })
	assert.equal(first.status, 'needs_decision')
	assert.deepEqual(first.reasons, ['Target prerequisites are not ready. Inspect the profile.'])
	assert.equal(save({ readyForLiveExecution: false }).data.recorded, false)
	assert.throws(() => save({ readyForLiveExecution: true }), /exists with other content. Save revision 2/)
	const second = save({ revision: 2, approvals: { plan: 'none', result: 'required' } })
	assert.equal(second.status, 'completed')
	assert.equal(second.subject, 'checkout-local@2')
	assert.equal(targetRevision(opened, 'checkout-local').revision, 2)
	assert.equal(targetRevision(opened, 'checkout-local', 1).profile.readyForLiveExecution, false)
})

test('target save removes the setup output directory of the target', (t) => {
	const opened = store(t)
	const tmp = join(opened.workspace, '.checkmate', 'tmp')
	mkdirSync(join(tmp, 'setup-checkout-local'), { recursive: true })
	writeFileSync(join(tmp, 'setup-checkout-local', 'page.yml'), 'snapshot')
	mkdirSync(join(tmp, 'run-1'))
	target(opened)
	assert.deepEqual(readdirSync(tmp), ['run-1'])
})

test('target show prints a revision with the default approval policy', (t) => {
	const opened = store(t)
	target(opened)
	const shown = showTarget(opened, 'checkout-local')
	assert.equal(shown.subject, 'checkout-local@1')
	assert.deepEqual(shown.data.approvals, { plan: 'required', result: 'required' })
	assert.throws(() => showTarget(opened, 'checkout-local@3'), /Unknown target profile: checkout-local@3/)
	assert.throws(() => showTarget(opened, 'checkout-local@x'), /Use <id> or <id>@<revision>/)
})

test('a setup request names tools; the profile records each one and an unreachable one blocks readiness', (t) => {
	const opened = store(t)
	const tools = [
		{ name: 'playwright-cli', kind: 'cli' as const, purpose: 'Drive the browser.' },
		{ name: 'jira', kind: 'mcp' as const, purpose: 'Read tickets.' },
	]
	assert.throws(
		() => openTarget(opened, actor, { ...request, tools: [{ ...tools[0], kind: 'binary' as 'cli' }] }),
		/Invalid kind of tool playwright-cli: binary/
	)
	assert.throws(() => openTarget(opened, actor, { ...request, tools: [tools[0], tools[0]] }), /Duplicate tool name/)
	openTarget(opened, actor, { ...request, tools })
	assert.deepEqual(showTargetRequest(opened, 'checkout-local').data.request, { ...request, tools })
	const save = (overrides: Parameters<typeof profile>[0]) =>
		saveTarget(opened, actor, { targetId: 'checkout-local', profile: profile(overrides) })
	assert.throws(() => save({}), /Profile has no entry for the requested tool jira/)
	const recorded = (reachable: boolean) => [
		...profile().tools,
		{ name: 'jira', kind: 'mcp' as const, purpose: 'Read tickets.', reachable },
	]
	assert.throws(
		() => save({ tools: [...profile().tools, { name: 'jira', kind: 'skill', purpose: 'x', reachable: true }] }),
		/Tool jira is skill in the profile, not mcp/
	)
	assert.throws(
		() => save({ tools: recorded(false) }),
		/Requested tool jira \(mcp\) is not reachable\. Set readyForLiveExecution to false/
	)
	const blocked = save({ tools: recorded(false), readyForLiveExecution: false })
	assert.equal(blocked.status, 'needs_decision')
	assert.deepEqual(blocked.reasons, [
		'Requested tool jira (mcp) is not reachable',
		'Target prerequisites are not ready. Inspect the profile.',
	])
	assert.equal(save({ revision: 2, tools: recorded(true) }).status, 'completed')
	const shown = cli(opened.workspace, ['target', 'show', 'checkout-local'])
	assert(shown.lines.includes('tool\tjira\tmcp\t-\treachable\tRead tickets.'), shown.output)
	assert(shown.lines.includes('tool\tplaywright-cli\tcli\t0.1.23\treachable\tDrive the browser.'), shown.output)
})

test('target open reads repeatable --tool name:kind:purpose options', (t) => {
	const workspace = store(t).workspace
	const open = (...tools: string[]) =>
		cli(workspace, [
			'target',
			'open',
			'web',
			'--entry-point',
			'web:url:Web application.',
			'--capabilities',
			'browser',
			'--operations',
			'read',
			...tools.flatMap((tool) => ['--tool', tool]),
		])
	assert.match(open('playwright-cli:browser').output, /Invalid --tool: playwright-cli:browser/)
	assert.equal(
		open('playwright-cli:cli:Drive the browser: click and read.', 'checkmate:ui:skill:Show results.').code,
		0
	)
	assert.deepEqual(cli(workspace, ['target', 'request', 'web']).lines.slice(-2), [
		'tool\tplaywright-cli\tcli\tDrive the browser: click and read.',
		'tool\tcheckmate:ui\tskill\tShow results.',
	])
})

test('target open reads repeatable --entry-point name:kind:purpose options', (t) => {
	const workspace = store(t).workspace
	const open = (...entries: string[]) =>
		cli(workspace, [
			'target',
			'open',
			'crm',
			...entries.flatMap((entry) => ['--entry-point', entry]),
			'--capabilities',
			'browser',
			'--operations',
			'read',
		])
	assert.match(open('web:url').output, /Invalid --entry-point: web:url\. Use <name>:<url\|command\|value>:<purpose>/)
	assert.match(open('web:socket:Web.').output, /Invalid --entry-point: web:socket:Web\./)
	assert.match(
		cli(workspace, ['target', 'open', 'crm', '--capabilities', 'a', '--operations', 'b']).output,
		/Missing --entry-point/
	)
	assert.equal(open('web:command:Login URL: one-time.', 'org:value:Org alias.').code, 0)
	assert.deepEqual(cli(workspace, ['target', 'request', 'crm']).lines.slice(1, 3), [
		'entryPoint\tweb\tcommand\tLogin URL: one-time.',
		'entryPoint\torg\tvalue\tOrg alias.',
	])
})

function salesforce(t: Parameters<typeof store>[0]) {
	const opened = store(t)
	const entryPoints = [
		{ name: 'web', kind: 'command' as const, purpose: 'One-time login URL of the org.' },
		{ name: 'org', kind: 'value' as const, purpose: 'Org alias for sf commands.' },
		{ name: 'api', kind: 'url' as const, purpose: 'REST endpoint.' },
	]
	openTarget(opened, actor, { ...request, targetId: 'crm', entryPoints })
	return opened
}

const sandbox = {
	entries: {
		web: 'sf org open --target-org uat --url-only --json',
		org: 'uat',
		api: 'https://uat.my.example.com/services',
	},
	environment: 'UAT sandbox',
	references: ['sf alias uat'],
}

test('an instance gives a value for each entry point of the target', (t) => {
	const opened = salesforce(t)
	const add = (instanceId: string, instance: unknown) =>
		addInstance(opened, actor, { targetId: 'crm', instanceId, instance })
	assert.throws(() => add('uat', { entries: { web: 'x', org: 'uat' } }), /Missing value for entry point: api/)
	assert.throws(
		() => add('uat', { entries: { ...sandbox.entries, cli: 'x' } }),
		/Unknown entry point: cli\. The target has: web, org, api/
	)
	assert.throws(() => add('uat', { entries: { ...sandbox.entries, api: 'not a url' } }), /needs a valid URL/)
	assert.throws(
		() => add('uat', { entries: { ...sandbox.entries, api: 'https://user:secret@uat.example.com' } }),
		/URL credentials/
	)
	assert.throws(() => add('uat', { entries: { ...sandbox.entries, org: '' } }), /Invalid instance/)
	assert.throws(() => add('uat', { ...sandbox, secret: 'x' }), /Invalid instance/)
	assert.throws(() => add('bad id', sandbox), /Invalid instance ID: bad id/)
	assert.throws(
		() => addInstance(opened, actor, { targetId: 'nope', instanceId: 'uat', instance: sandbox }),
		/Unknown target: nope/
	)
	assert.equal(
		add('uat', { ...sandbox, entries: { ...sandbox.entries, api: 'sftp://files.example.com/in' } }).status,
		'completed'
	)
	assert.equal(findInstance(opened, 'crm', 'uat').entries.api, 'sftp://files.example.com/in')
	assert.throws(() => add('uat', sandbox), /Instance crm\/uat exists\. An instance does not change/)
	const again = add('uat', { ...sandbox, entries: { ...sandbox.entries, api: 'sftp://files.example.com/in' } })
	assert.equal(again.data.recorded, false)
})

test('instances are added and retired without a new revision; retired IDs are not used again', (t) => {
	const opened = salesforce(t)
	addInstance(opened, actor, { targetId: 'crm', instanceId: 'uat', instance: sandbox })
	assert.equal(targetHistory(opened, 'crm').length, 0)
	const retired = retireInstance(opened, actor, { targetId: 'crm', instanceId: 'uat' })
	assert.equal(retired.data.recorded, true)
	assert.equal(retireInstance(opened, actor, { targetId: 'crm', instanceId: 'uat' }).data.recorded, false)
	assert.throws(
		() => retireInstance(opened, actor, { targetId: 'crm', instanceId: 'prod' }),
		/Unknown instance: crm\/prod/
	)
	assert.throws(
		() => addInstance(opened, actor, { targetId: 'crm', instanceId: 'uat', instance: sandbox }),
		/Instance crm\/uat exists/
	)
	addInstance(opened, actor, { targetId: 'crm', instanceId: 'uat-2', instance: sandbox })
	const list = instanceList(opened, 'crm')
	assert.deepEqual(
		list.map((instance) => [instance.instanceId, instance.retired?.actor ?? null]),
		[
			['uat', actor],
			['uat-2', null],
		]
	)
	assert.deepEqual(list[1].references, ['sf alias uat'])
	assert.deepEqual(targetList(opened), [
		{
			targetId: 'crm',
			revision: null,
			capabilities: request.capabilities,
			entryPoints: ['web', 'org', 'api'],
			activeInstances: 1,
		},
	])
	const commands = operationLog(opened, { subject: 'target:crm' }).map((operation) => operation.command)
	assert.deepEqual(commands, ['target instance add', 'target instance retire', 'target instance add', 'target open'])
})

test('target list, show, and instance commands print entry points, authentication, and instance values', (t) => {
	const opened = store(t)
	target(opened, { authentication: { kind: 'environment', references: ['SHOP_TOKEN'] } })
	const workspace = opened.workspace
	const add = cli(workspace, [
		'target',
		'instance',
		'add',
		'checkout-local',
		'staging',
		'--entry',
		'web=https://staging.example.com/?a=b',
		'--environment',
		'Staging',
		'--reference',
		'staging-login',
	])
	assert.equal(add.code, 0, add.output)
	assert.deepEqual(add.lines, [
		'completed checkout-local/staging recorded=true',
		'entry\tweb\thttps://staging.example.com/?a=b',
	])
	assert.match(
		cli(workspace, ['target', 'instance', 'add', 'checkout-local', 'x', '--entry', 'web']).output,
		/Invalid --entry: web\. Use <entryPoint>=<value>/
	)
	assert.match(
		cli(workspace, ['target', 'instance', 'add', 'checkout-local', 'x', '--environment', 'y'], '{}').output,
		/Give --entry with --environment and --reference, or send the instance on standard input/
	)
	const piped = json(workspace, ['target', 'instance', 'add', 'checkout-local', 'piped'], {
		entries: { web: 'http://127.0.0.1:5000' },
	})
	assert.equal(piped.body.status, 'completed')
	assert.deepEqual(cli(workspace, ['target', 'list']).lines, [
		'completed targets count=1',
		'checkout-local@1\tcapabilities=browser,http\tinstances=3',
	])
	const shown = cli(workspace, ['target', 'show', 'checkout-local', '--instance', 'staging'])
	assert.equal(shown.lines[0].startsWith('completed checkout-local@1 sha256='), true, shown.output)
	assert.match(shown.lines[0], /instance=staging retired=false$/)
	for (const line of [
		'entryPoint\tweb\turl\tCheckout web application and HTTP API.',
		'authentication\tenvironment\tSHOP_TOKEN',
		'instance\tlocal\tlocal fixture',
		'entry\tweb\thttps://staging.example.com/?a=b',
		'environment\tStaging',
		'reference\tstaging-login',
	])
		assert(shown.lines.includes(line), `${line}\n${shown.output}`)
	assert.equal(cli(workspace, ['target', 'instance', 'retire', 'checkout-local', 'piped']).code, 0)
	assert.deepEqual(cli(workspace, ['target', 'instance', 'list', 'checkout-local']).lines, [
		'completed checkout-local count=3',
		'local\tactive\tlocal fixture\tweb=http://127.0.0.1:4173',
		'staging\tactive\tStaging\tweb=https://staging.example.com/?a=b',
		'piped\tretired\t-\tweb=http://127.0.0.1:5000',
	])
	assert.match(cli(workspace, ['target', 'show', 'checkout-local', '--instance', 'nope']).output, /Unknown instance/)
	assert.match(
		cli(workspace, ['target', 'instance', 'drop', 'checkout-local']).output,
		/Unknown command: target instance/
	)
})
