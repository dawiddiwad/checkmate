---
name: revise
description: Apply recorded caller decisions to a Checkmate plan. Write a delta for the affected tests and save the next revision with plan revise.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`. It has the command rules, the actor rules, and the report format.

1. Run `checkmate plan pending <planId>`. It prints each pending decision, then the affected gaps and tests with their assertions.
2. If there is no pending decision, stop. Return `needs_decision` with the reason `No pending decision`.
3. For each decision, find the change in the affected tests that the decision value requires.
4. Write the delta. Use the shape below.
5. Send the delta in a heredoc: `checkmate plan revise <planId> <<'EOF'`, the JSON, then `EOF`.
6. If the command refuses the delta, correct it and run step 5 again.
7. Return the response of `plan revise`.
8. In the same session, report to the caller in the format of `workflow.md`. Show the changed tests (Test, Readiness, Title) and the gaps that are still open. In `Next:`, name the plan approval: `checkmate plan approve <planId@rev> --rationale "<why>"`, or the review UI.

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

- Change only tests that `plan pending` prints. Change only `action`, `preconditions`, and `assertions`.
- In `assertions`, a known ID changes that assertion. A new ID adds an assertion. `null` removes an assertion. Do not reuse a removed ID.
- A new assertion needs both `check` and `oracleKind`. A change can give only the changed field.
- `clarify`: write the assertions that the decision value makes known. Use the exact value from the decision.
- `accept_assumption`: write the assertions that the assumption makes known.
- `defer`: change no assertion for that gap. Send `{ "tests": {} }` when every decision is `defer`.
- Do not write gap status, decisions, or assumptions. Checkmate applies them from the pending decisions.
- Do not invent a decision. Do not answer a gap. Only the caller records a decision, with `checkmate gap answer` or in the review UI.
