---
name: revise
description: Apply recorded oracle answers to a Checkmate plan and save the next revision. Not for testing: a request to test goes to the test skill.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`. It has the command rules, the actor rules, and the safety rules. In the same session as the oracle, also read `${CLAUDE_PLUGIN_ROOT}/references/session.md`: it tells you how to report.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

1. Run `checkmate plan pending <planId>`. It prints each pending decision with its ID, gap, kind, value, and rationale, then the affected gaps and tests with their assertions.
2. If there is no pending decision, stop. Return `needs_decision` with the reason `No pending decision`.
3. For each decision, find the change in the affected tests that the decision value requires. Read the rationale too. It can limit or explain the value.
4. Write the delta. Use the shape below.
5. Send the delta in a heredoc: `checkmate plan revise <planId> --actor claude:revise <<'EOF'`, the JSON, then `EOF`.
6. If the command refuses the delta, correct it and run step 5 again.
7. Return the response of `plan revise`.
8. In the same session, report to the oracle as `session.md` says. In `Next:`, name the plan approval: `checkmate plan approve <planId@rev> --rationale "<why>"`, or the review UI.

```json
{
	"tests": {
		"T2": {
			"title": "Order",
			"requirementIds": ["R2"],
			"capability": "http",
			"operations": ["read_catalog"],
			"dependsOn": [],
			"preconditions": [],
			"action": "Read the list.",
			"assertions": [
				{ "check": "The newest item is first.", "checkKind": "deterministic" },
				{ "check": "The list has at most 10 items.", "checkKind": "deterministic" }
			]
		}
	},
	"requirements": {
		"R7": { "text": "The list has at most 10 items.", "source": "ticket.md" }
	}
}
```

Rules:

- Change only tests that `plan pending` prints. Send each one whole.
- When a decision drops a criterion or puts it out of scope, remove its requirement and its tests in the same delta: `"requirements": { "R2": { "remove": true } }` and `"tests": { "T2": { "remove": true } }`. A requirement stays while any of its tests stays.
- Keep each test independent. A changed precondition creates its own data. It does not use the records of another test.
- A delta does not change `metadata`. The team fields of each test stay in the next revision. Do not put team fields in a check. To change `metadata`, the oracle uses `plan edit --patch`.
- Send each changed test whole. The code keeps an assertion ID when its check text is unchanged. Do not send assertion IDs. Give one value in each check.
- Each assertion needs `check` and `checkKind`. A test that a decision drops is removed with `{ "remove": true }`.
- `clarify`: write the assertions that the decision value makes known. Use the exact value from the decision.
- `accept_assumption`: write the assertions that the assumption makes known. When the decision and the sources give no expected value, do not invent one and do not stop. Write one `agent_observation` assertion that records the behavior and checks only what the sources state, for example: "Record whether the code is applied or refused. The cart total stays consistent and no error shows."
- `defer`: change no assertion for that gap. A deferred blocking gap defers its tests. A deferred non-blocking gap only closes, and its tests stay ready. Send `{ "tests": {} }` when every decision is `defer`.
- Do not write gap status, decisions, or assumptions. Checkmate applies them from the pending decisions.
- Do not invent a decision. Do not answer a gap. Only the oracle records a decision, with `checkmate gap answer` or in the review UI.
