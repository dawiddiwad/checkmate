---
name: revise
description: Apply recorded caller decisions to a Checkmate plan. Write a delta for the affected tests and save the next revision with plan revise.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Run `checkmate plan pending <planId>`. It prints each pending decision, then the affected gaps and tests with their assertions.
2. If there is no pending decision, stop. Return `needs_decision` with the reason `No pending decision`.
3. For each decision, find the change in the affected tests that the decision value requires.
4. Run `checkmate plan request <planId>` for the current context and tool instructions.
5. Send the delta directly to `checkmate plan revise <planId> --expect-sha <SHA from plan pending>` on standard input. Use the shape below. Do not save a JSON file.
6. If the command refuses the delta, correct it and run step 5 again.
7. Read `checkmate plan show <planId>` again. Return the response of `plan revise`.

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
