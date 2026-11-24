import type { Actions } from './types.ts'
import type { Reply, Store } from './store.ts'
import type { Env } from './sessions.ts'
import { Refusal, schemaProblems } from './contracts.ts'
import { replaceInstance, setupTarget } from './targets.ts'

export type ActionName = keyof Actions
type ActionContext = { actor: string | undefined; env: Env }

const handlers: {
	[Name in ActionName]: (store: Store, input: NonNullable<Actions[Name]>, context: ActionContext) => Reply
} = {
	setup: (store, input, { actor, env }) => setupTarget(store, actor, { ...input, env }),
	replace_instance: (store, input, { actor }) => replaceInstance(store, actor, input),
}

export function performAction<Name extends ActionName>(
	store: Store,
	name: Name,
	input: unknown,
	context: ActionContext
) {
	const problems = schemaProblems('actions', { [name]: input }, 'input').map((problem) => problem.text)
	if (problems.length)
		throw new Refusal('malformed', problems.join('. '), 'Correct the named fields and retry the action.')
	return handlers[name](store, input as NonNullable<Actions[Name]>, context)
}

export function actionRecovery(name: ActionName, reply: Reply) {
	if (!['rejected', 'invalid_request', 'needs_decision', 'operational_error'].includes(reply.status)) return reply
	return {
		...reply,
		data: {
			...reply.data,
			nextAction: {
				action: name,
				instruction:
					reply.hint ??
					(typeof reply.data.next === 'string'
						? reply.data.next
						: 'Resolve the condition in reasons before retrying this action. Ask the oracle for any missing decision.'),
			},
		},
	}
}
