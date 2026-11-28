function words(value) {
	return value.replaceAll('_', ' ')
}

export function waitingOf(inbox) {
	return [
		...inbox.gaps.map((gap) => ({
			planId: gap.planId,
			id: gap.explorationId ? `${gap.planId}/${gap.gapId}` : `${gap.planId}@${gap.revision}/${gap.gapId}`,
			kind: gap.explorationId ? 'question' : gap.runId ? 'run gap' : 'gap',
			detail: words(gap.severity),
			text: gap.question,
		})),
		...inbox.plans.map((plan) => ({
			planId: plan.planId,
			id: `${plan.planId}@${plan.revision}`,
			kind: 'plan',
			detail: `approval ${plan.approval}`,
			text: plan.summary,
		})),
		...inbox.results.map((result) => ({
			planId: result.planId,
			id: result.runId,
			kind: 'result',
			detail: `${result.planId}@${result.revision} build ${result.build}`,
			text: [
				`coverage ${result.coverage}`,
				...Object.entries(result.counts).map(([outcome, count]) => `${count} ${words(outcome)}`),
			].join(', '),
		})),
		...inbox.claims.map((claim) => ({
			planId: claim.planId,
			id: `${claim.planId}/${claim.claimId}`,
			kind: 'claim',
			detail: `${words(claim.state)}, ${claim.severity}`,
			text: claim.title,
		})),
		...inbox.requests.map((request) => ({
			planId: request.planId,
			id: request.planId,
			kind: 'requested',
			detail: request.target,
			text: request.objective,
		})),
	]
}

export function planLinesOf(list) {
	return list.plans.map((plan) => ({
		planId: plan.planId,
		state: words(plan.loop.state),
		waitsOn: plan.loop.waitsOn,
		detail:
			plan.revision === null
				? 'no plan yet'
				: `revision ${plan.revision}, ${plan.tests.total} tests, ${plan.tests.ready} ready, ${plan.tests.blocked} blocked, ${plan.openGaps.length} open gaps`,
	}))
}
