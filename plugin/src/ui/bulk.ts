export type BulkState = {
	what: 'questions' | 'claims'
	values: Record<string, string>
	error: string | null
	confirm: boolean
}

const kindLabels: Record<string, string> = {
	clarify: 'Clarify',
	accept_assumption: 'Accept assumption',
	defer: 'Defer',
}

export function answerDefaults(values: Record<string, string>, actor: string) {
	const kind = values.kind || 'clarify'
	return {
		kind,
		value: values.value?.trim() || (kind === 'defer' ? 'Deferred in the review UI.' : ''),
		source: values.source?.trim() || `${actor}, in the review UI`,
		rationale: values.rationale?.trim() || 'Answered in the review UI. No reason was given.',
	}
}

export function claimDefaults(values: Record<string, string>) {
	const verdict = values.verdict === 'rejected' ? ('rejected' as const) : ('approved' as const)
	return {
		verdict,
		rationale:
			values.rationale?.trim() ||
			(verdict === 'approved' ? 'Accepted in the review UI. No reason was given.' : ''),
	}
}

export function bulkProblem(what: BulkState['what'], values: Record<string, string>, actor: string) {
	if (!actor) return 'Enter your name. Checkmate records it with each decision.'
	if (what === 'questions') {
		const answer = answerDefaults(values, actor)
		if (!kindLabels[answer.kind]) return 'Choose Defer, Clarify, or Accept assumption.'
		if (!answer.value) return 'Write the answer. Only Defer needs no answer.'
		return null
	}
	if (values.verdict !== 'approved' && values.verdict !== 'rejected') return 'Choose Accept or Reject.'
	if (!claimDefaults(values).rationale) return 'Write a short reason for the reject.'
	return null
}
