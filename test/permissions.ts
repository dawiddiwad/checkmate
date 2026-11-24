import { readFileSync } from 'node:fs'
import { setTimeout as pause } from 'node:timers/promises'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { decidePermission, explorationPermissions, openPermissions } from '../plugin/src/permissions.ts'
import { requestPermission } from '../plugin/src/permissions.ts'
import { uiFilePath } from '../plugin/src/sessions.ts'

export type Answer = { status: number; body: string }

export const plainBody = (decision: string) =>
	`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":${decision}}}`

export const toolRule = (tool: string) =>
	`{"type":"addRules","rules":[{"toolName":"${tool}"}],"behavior":"allow","destination":"session"}`

export const kindRuleBody = (rule: string, destination: string) =>
	plainBody(
		`{"behavior":"allow","updatedPermissions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"${rule}"}],"behavior":"allow","destination":"${destination}"}]}`
	)

export function bash(command: string, rule?: string, cwd = '/work/app') {
	return {
		tool_name: 'Bash',
		tool_input: { command },
		cwd,
		permission_suggestions: rule
			? [
					{
						type: 'addRules',
						rules: [{ toolName: 'Bash', ruleContent: rule }],
						behavior: 'allow',
						destination: 'localSettings',
					},
				]
			: [],
	}
}

export function asking(ui: { url: string }, workspace: string, explorationId: string, who: string, body: object) {
	const token = (JSON.parse(readFileSync(uiFilePath(workspace), 'utf8')) as { hookToken: string }).hookToken
	return fetch(new URL(`/hooks/permission/${explorationId}/${who}`, ui.url), {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ hook_event_name: 'PermissionRequest', ...body }),
	}).then(async (reply): Promise<Answer> => ({ status: reply.status, body: await reply.text() }))
}

export function permissionsOf<T>(workspace: string, view: (reading: ReturnType<typeof openStore>) => T) {
	const reading = openStore(workspace)
	try {
		return view(reading)
	} finally {
		closeStore(reading)
	}
}

export const openOf = (workspace: string) => permissionsOf(workspace, (reading) => openPermissions(reading))
export const allOf = (workspace: string, explorationId: string) =>
	permissionsOf(workspace, (reading) => explorationPermissions(reading, explorationId))

export async function waitOpen(workspace: string, count: number) {
	for (let tries = 0; tries < 600; tries++) {
		if (openOf(workspace).length === count) return
		await pause(25)
	}
	throw new Error(`Timed out: ${count} open permission requests`)
}

export function seedHistory(
	workspace: string,
	explorationId: string,
	who: string,
	commands: string[],
	by = 'dawid',
	decision = 'allow'
) {
	const reading = openStore(workspace)
	try {
		for (const command of commands) {
			const made = requestPermission(reading, {
				askerId: explorationId,
				who,
				tool: 'Bash',
				input: { command },
				suggestions: [],
				cwd: '/work/app',
			})
			decidePermission(reading, by, { askerId: explorationId, requestId: made.id, decision }, () => {})
		}
	} finally {
		closeStore(reading)
	}
}
