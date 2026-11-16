import type { TestContext } from 'node:test'
import type { Profile } from '../plugin/src/types.ts'
import type { Store } from '../plugin/src/store.ts'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeStore, createStore } from '../plugin/src/store.ts'
import { addInstance, openTarget, saveTarget } from '../plugin/src/targets.ts'
import { run } from '../plugin/src/cli.ts'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const actor = 'tester'

export function directory(t?: TestContext) {
	const path = mkdtempSync(join(tmpdir(), 'checkmate-test-'))
	t?.after(() => rmSync(path, { recursive: true, force: true }))
	return path
}

export function copied(t: TestContext, template: string) {
	const workspace = directory(t)
	cpSync(template, workspace, { recursive: true })
	return workspace
}

export function store(t: TestContext, workspace = directory(t)): Store {
	const opened = createStore(workspace)
	t.after(() => {
		if (opened.db.isOpen) closeStore(opened)
	})
	return opened
}

export function cli(workspace: string, args: string[], stdin: unknown = undefined, env: Record<string, string> = {}) {
	const outcome = run([...args, '--workspace', workspace], {
		cwd: workspace,
		env: { CHECKMATE_ACTOR: actor, ...env },
		stdin: () => (stdin === undefined ? '' : typeof stdin === 'string' ? stdin : JSON.stringify(stdin)),
	})
	return { ...outcome, lines: outcome.output.split('\n') }
}

export function json(workspace: string, args: string[], stdin?: unknown) {
	const outcome = cli(workspace, [...args, '--json'], stdin)
	return { code: outcome.code, body: JSON.parse(outcome.output) }
}

export function profile(overrides: Partial<Profile> = {}): Profile {
	return {
		contractVersion: 'toolkit-2',
		targetId: 'checkout-local',
		revision: 1,
		entryPoints: [{ name: 'web', kind: 'url', purpose: 'Checkout web application and HTTP API.' }],
		capabilities: ['browser', 'http'],
		tools: [
			{
				name: 'playwright-cli',
				kind: 'cli',
				purpose: 'Drive the browser.',
				version: '0.1.23',
				reachable: true,
			},
			{ name: 'node', kind: 'cli', purpose: 'Send HTTP requests.', version: '24.12.0', reachable: true },
		],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		startup: { owner: 'factory', command: null },
		cleanup: 'Close the run browser session. The fixture stores no records.',
		readyForLiveExecution: true,
		...overrides,
	}
}

export const webUrl = 'http://127.0.0.1:4173'

export function target(store: Store, overrides: Partial<Profile> = {}, web = webUrl) {
	const value = profile(overrides)
	openTarget(store, actor, {
		targetId: value.targetId,
		entryPoints: value.entryPoints,
		capabilities: value.capabilities,
		allowedOperations: value.allowedOperations,
	})
	const saved = saveTarget(store, actor, { targetId: value.targetId, profile: value })
	addInstance(store, actor, {
		targetId: value.targetId,
		instanceId: 'local',
		instance: { entries: { web }, environment: 'local fixture' },
	})
	return saved
}
