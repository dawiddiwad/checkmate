import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile } from '../plugin/src/types.ts'
import { openPlan, patchPlan } from '../plugin/src/plans.ts'
import { saveRules } from '../plugin/src/rules.ts'
import { closeStore, completed, openStore, write } from '../plugin/src/store.ts'
import { done, ended, launched, openTest } from './explorations.ts'
import { actor, target } from './support.ts'

export const noteRules = [
	{ id: 'R1', text: 'A note keeps its title after a save.', source: 'notes.md#save', area: 'Saving' },
	{ id: 'R2', text: 'A deleted note leaves the list.', source: 'notes.md#delete', area: 'Deleting' },
	{ id: 'R3', text: 'A note has at most 200 characters in its title.', source: 'notes.md#save', area: 'Saving' },
]

function evidence(workspace: string, name: string, text: string) {
	const folder = join('.checkmate', 'tmp', 'notes')
	mkdirSync(join(workspace, folder), { recursive: true })
	writeFileSync(join(workspace, folder, name), text)
	return join(folder, name)
}

export function seedNotes(workspace: string, overrides: Partial<Profile> = {}) {
	const store = openStore(workspace)
	try {
		target(store, overrides)
		openPlan(store, actor, {
			planId: 'notes',
			target: 'checkout-local@1',
			request: { objective: 'Check the plan notes.', context: { sources: ['notes.md'] } },
		})
		write(store, { actor, command: 'rules derive', subject: 'notes', input: null }, (id) => {
			saveRules(store, id, 'notes', noteRules, 'derived')
			return { reply: completed('notes'), subjects: ['plan:notes'] }
		})
		openTest(store, 'notes', 'x-1', 'b1', 'local')
		launched(store, 'x-1', 'k1')
		const defect = (id: string, rule: string, severity: string, title: string, file: string) => ({
			kind: 'defect',
			id,
			rule,
			severity,
			title,
			expected: `${title} does not happen.`,
			actual: `${title} happens.`,
			steps: ['Open the notes.', `Do the thing for ${id}.`],
			evidence: [evidence(workspace, file, `Log of ${id}.\n`), `Seen on build b1: ${title}.`],
		})
		ended(store, 'x-1', 'k1', [
			defect('D1', 'R1', 'high', 'The title is lost after a save', 'k1-D1.txt'),
			defect('D2', 'R2', 'critical', 'A deleted note stays in the list', 'k1-D2.txt'),
			defect('D3', 'R3', 'low', 'A title of 300 characters is saved', 'k1-D3.txt'),
			{ kind: 'question', id: 'Q1', rule: 'R2', question: 'Does a delete need a confirm?' },
		])
		done(store, 'x-1')
		openTest(store, 'notes', 'x-2', 'b2', 'local')
		launched(store, 'x-2', 'k1')
		ended(store, 'x-2', 'k1', [
			{ kind: 'verdict', defect: 'D1', result: 'not_fixed' },
			{ kind: 'verdict', defect: 'D2', result: 'fixed' },
		])
		done(store, 'x-2')
	} finally {
		closeStore(store)
	}
}

export function seedStorable(workspace: string, overrides: Partial<Profile> = {}) {
	seedNotes(workspace, overrides)
	const store = openStore(workspace)
	try {
		patchPlan(store, actor, {
			reference: 'notes',
			patch: { requirements: { R4: { text: 'A note can be pinned.', source: 'notes.md#pin', area: 'Saving' } } },
		})
		addExploration(store, 'x-3', 'b3', 'D4')
	} finally {
		closeStore(store)
	}
}

export function addExploration(
	store: ReturnType<typeof openStore>,
	explorationId: string,
	build: string,
	id: string,
	rule?: string
) {
	openTest(store, 'notes', explorationId, build, 'local')
	launched(store, explorationId, 'k1')
	ended(store, explorationId, 'k1', [
		{
			kind: 'defect',
			id,
			...(rule ? { rule } : {}),
			severity: 'low',
			title: `A pinned note is lost (${id})`,
			expected: 'A pinned note stays.',
			actual: 'A pinned note is lost.',
			steps: ['Open the notes.', `Pin a note for ${id}.`],
		},
	])
	done(store, explorationId)
}
