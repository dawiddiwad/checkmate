export type Waiting = { planId: string; id: string; kind: string; detail: string; text: string }

export type PlanLine = { planId: string; state: string; waitsOn: string; detail: string }

export type Snapshot = { waiting: Waiting[]; plans: PlanLine[]; problem: string | null }

declare module 'claude-code' {
	interface PluginState {
		checkmate: { snapshot: Shaped<Snapshot | null> }
	}
}
