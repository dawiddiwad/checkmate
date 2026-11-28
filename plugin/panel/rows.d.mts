import type { PlanLine, Waiting } from '../types/index.d.ts'

export type Inbox = {
	gaps: Array<{
		planId: string
		revision: number | null
		gapId: string
		question: string
		severity: string
		runId: string | null
		explorationId: string | null
	}>
	plans: Array<{ planId: string; revision: number; approval: string; summary: string }>
	results: Array<{
		runId: string
		planId: string
		revision: number
		build: string
		counts: Record<string, number>
		coverage: string
	}>
	claims: Array<{ planId: string; claimId: string; state: string; severity: string; title: string }>
	requests: Array<{ planId: string; target: string; objective: string }>
}

export type PlanList = {
	plans: Array<{
		planId: string
		revision: number | null
		openGaps: string[]
		tests: { total: number; ready: number; blocked: number }
		loop: { state: string; waitsOn: string }
	}>
}

export function waitingOf(inbox: Inbox): Waiting[]
export function planLinesOf(list: PlanList): PlanLine[]
