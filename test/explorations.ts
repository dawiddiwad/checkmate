import type { Store } from '../plugin/src/store.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { completed, saveBlob, write } from '../plugin/src/store.ts'
import { addEvent, openExploration, workFolder } from '../plugin/src/explorations.ts'
import { logEntries } from '../plugin/src/journal.ts'

type Step = { step: string; explorer?: string; status?: string; detail?: Record<string, unknown> }

export const launch = { level: 'smoke', explorers: 2, model: 'host-model', modelFrom: 'host', verifier: false }

export function event(store: Store, explorationId: string, item: Step) {
	write(
		store,
		{ actor: 'checkmate', command: `explore ${item.step}`, subject: explorationId, input: item },
		(id, at) => {
			addEvent(
				store,
				explorationId,
				{
					step: item.step,
					explorer: item.explorer ?? null,
					status: item.status ?? 'started',
					detail: item.detail ?? {},
				},
				id,
				at
			)
			return { reply: completed(explorationId), subjects: [`exploration:${explorationId}`] }
		}
	)
}

export function entries(store: Store, explorationId: string, explorer: string, list: unknown[]) {
	logEntries(store, `qa:${explorer}`, { explorationId, entries: list })
}

export function files(
	store: Store,
	explorationId: string,
	explorer: string,
	phase: string,
	texts: Record<string, string>
) {
	const input = { explorer, phase, files: Object.keys(texts) }
	write(store, { actor: 'checkmate', command: 'explore files', subject: explorationId, input }, (id, at) => {
		const saved = Object.entries(texts).map(([name, text]) => ({ name, ...saveBlob(store, Buffer.from(text)) }))
		addEvent(
			store,
			explorationId,
			{ step: 'files', explorer, status: 'completed', detail: { phase, files: saved } },
			id,
			at
		)
		return { reply: completed(explorationId), subjects: [`exploration:${explorationId}`] }
	})
}

export function report(store: Store, explorationId: string, explorer: string, text: string) {
	files(store, explorationId, explorer, 'test', { 'report.md': text })
}

export function keptWork(store: Store, explorationId: string) {
	mkdirSync(join(store.workspace, workFolder(explorationId)), { recursive: true })
}

export function openTest(store: Store, planId: string, explorationId: string, build: string, instance?: string) {
	openExploration(store, 'checkmate', { planId, build, explorationId, ...(instance ? { instance } : {}) })
	event(store, explorationId, { step: 'start', detail: launch })
	event(store, explorationId, { step: 'supervisor', detail: { pid: process.pid } })
}

export function launched(store: Store, explorationId: string, explorer: string) {
	event(store, explorationId, { step: 'launch', explorer, detail: { session: `session-${explorer}` } })
}

export function ended(store: Store, explorationId: string, explorer: string, list: unknown[]) {
	event(store, explorationId, {
		step: 'end',
		explorer,
		status: 'completed',
		detail: { session: `session-${explorer}` },
	})
	if (list.length) entries(store, explorationId, explorer, list)
	event(store, explorationId, {
		step: 'record',
		explorer,
		status: 'completed',
		detail: { session: `session-${explorer}`, saved: list.length },
	})
}

export function done(store: Store, explorationId: string, status = 'completed', detail: Record<string, unknown> = {}) {
	event(store, explorationId, { step: 'done', status, detail })
}

export const coupon = { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }
export const stacks = {
	kind: 'defect',
	id: 'D1',
	title: 'Two coupons stack',
	severity: 'high',
	expected: 'One coupon applies.',
	actual: 'Both coupons apply.',
	suspected: true,
}
