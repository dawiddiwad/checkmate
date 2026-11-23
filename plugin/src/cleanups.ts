import type { Store } from './store.ts'
import { owedCleanups, settleCleanups } from './resets.ts'
import { runResult } from './runs.ts'
import { explorationStatus } from './explorers.ts'

const runningStates = ['starting', 'testing', 'recording', 'verifying', 'following']

// A cleanup owed by a run or exploration that has ended is settled before the next run or exploration
// starts on the workspace. A cleanup owed by a run that is started but not finished stays owed, and
// the status names the command that settles it.
export function settleEnded(store: Store) {
	const ended = owedCleanups(store)
		.map((item) => item.id)
		.filter((id) => {
			if (runResult(store, id)) return true
			try {
				return !runningStates.includes(explorationStatus(store, id).state)
			} catch {
				return false
			}
		})
	return ended.length ? settleCleanups(store, ended) : []
}

export function owedLines(store: Store) {
	return owedCleanups(store).map((item) => `Cleanup owed by ${item.id}: checkmate cleanup ${item.id}`)
}
