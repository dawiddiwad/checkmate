---
name: revise
description: Apply recorded gap decisions or correct a rejected Checkmate plan. Save a new revision for caller review.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Run `checkmate plan show <planId> --json` and `checkmate plan pending <planId> --json`. Read the current approval verdict and rationale, each pending gap answer's value and rationale, and the affected gaps and tests. If rejected, retain that revision reference and rationale until the correction is addressed or reported as outstanding.
2. Run `checkmate plan request <planId>` for the current context and tool instructions.
3. If gap decisions are pending, follow **Pending gap decisions** below. Otherwise, if the current approval is rejected, follow **Rejected plan**. If neither applies, return `needs_decision` with the missing decision. Do not say there is no reason merely because there is no pending gap answer.

## Rejected plan

1. Use the rejection rationale read at the start. Apply only the correction the caller requested. Start from the latest saved objective, requirements, and tests. If the correction is unclear, return `needs_decision` with the recorded rationale and the missing detail, even if you already saved a gap revision.
2. Send the full `objective`, `requirements`, and `tests` directly to `checkmate plan edit <planId> --expect-sha <SHA from plan show>` on standard input. Do not invent a gap answer or create another plan.
3. Read `checkmate plan show <planId> --json` again. Return the response of `plan edit`. The new revision needs its own approval. Do not approve it or run test actions.

## Pending gap decisions

1. For each decision, find the change in the affected tests that the decision value requires.
2. Send the delta directly to `checkmate plan revise <planId> --expect-sha <SHA from plan pending>` on standard input. Use the shape below. Do not save a JSON file.
3. If the command refuses the delta, correct it and run step 2 again.
4. Read `checkmate plan show <planId> --json` again. If the original revision was rejected, check its saved rationale against the new revision. If it still needs a correction, follow **Rejected plan** with the new digest. If you cannot determine the correction, return `needs_decision` with the original rationale and the outstanding detail. Do not lose rejection feedback because the new revision has no approval yet.
5. Return the response of the final write only when the gap answers and any requested rejection correction are addressed. The new revision needs its own approval. Do not approve it or run test actions.

```json
{
	"tests": {
		"T2": {
			"preconditions": ["Cart has one 400 PLN item and 20 PLN loyalty."],
			"assertions": {
				"A1": { "check": "totalPLN equals 240." },
				"A2": { "check": "The quote lists the promotion once.", "oracleKind": "deterministic" },
				"A3": null
			}
		}
	}
}
```

Rules:

- Preserve the scenario inputs from the request and the existing test unless the recorded decision explicitly changes them. For example, a decision that loyalty does not stack with a promotion changes the expected total; it does not remove the loyal customer or loyalty input from the scenario. Put the expected policy result in assertions.
- Keep actions and preconditions grounded in documented interfaces. Do not invent controls, endpoints, or parameters to apply a decision. Record an unresolved interface issue for the caller instead.
- Change only tests that `plan pending` prints. Change only `action`, `preconditions`, and `assertions`.
- In `assertions`, a known ID changes that assertion. A new ID adds an assertion. `null` removes an assertion. Do not reuse a removed ID.
- A new assertion needs both `check` and `oracleKind`. A change can give only the changed field.
- `clarify`: write the assertions that the decision value makes known. Use the exact value from the decision.
- `accept_assumption`: write the assertions that the assumption makes known.
- `defer`: change no assertion for that gap. Send `{ "tests": {} }` when every decision is `defer`.
- Do not write gap status, decisions, or assumptions. Checkmate applies them from the pending decisions.
- Do not invent a decision. Do not answer a gap. Only `checkmate gap answer` by the caller records a decision.
