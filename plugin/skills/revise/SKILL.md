---
name: revise
description: Apply recorded oracle answers to a Checkmate plan and save the next revision. Not for testing: a request to test goes to the test skill.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Use the Checkmate tools in the current session. Only apply decisions that the oracle recorded.

1. Call `checkmate_read_pending` with the plan ID. It prints each pending decision with its ID, gap, kind, value, and rationale, then the affected gaps and tests with their assertions.
2. If there is no pending decision, stop. Return `needs_decision` with the reason `No pending decision`.
3. For each decision, find the change in the affected tests that the decision value requires. Read the rationale too. It can limit or explain the value.
4. Write the delta. Use the shape below.
5. Call `checkmate_revise_plan` with the plan ID and the delta object.
6. If the tool refuses the delta, use its reasons and next action to correct it.
7. Return the response of `plan revise`.
8. In the same session, report to the oracle as `session.md` says. When the plan needs approval, ask for it and mention the plan page in the review UI.

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
- A delta does not change `metadata`. The team fields of each test stay in the next revision. Do not put team fields in a check. To change `metadata`, the oracle uses `checkmate_edit_plan` with a patch.
- Send each changed test whole. The code keeps an assertion ID when its check text is unchanged. Do not send assertion IDs. Give one value in each check.
- Each assertion needs `check` and `checkKind`. A test that a decision drops is removed with `{ "remove": true }`.
- `clarify`: write the assertions that the decision value makes known. Use the exact value from the decision.
- `accept_assumption`: write the assertions that the assumption makes known. When the decision and the sources give no expected value, do not invent one and do not stop. Write one `agent_observation` assertion that records the behavior and checks only what the sources state, for example: "Record whether the code is applied or refused. The cart total stays consistent and no error shows."
- `defer`: change no assertion for that gap. A deferred blocking gap defers its tests. A deferred non-blocking gap only closes, and its tests stay ready. Send `{ "tests": {} }` when every decision is `defer`.
- Do not write gap status, decisions, or assumptions. Checkmate applies them from the pending decisions.
- Do not invent a decision. Do not answer a gap. Only the oracle records a decision, with `checkmate_answer_gap` or in the review UI.
- Without a pending decision, a revise migrates the checks to the current shape: change only the tests that `plan show --json` shows with a deterministic check that has no `expected`, or a check that states more than one value. Give each migrated check `observe` and `expected` from the sources. Do not invent an expected value. When a split or a value needs a decision, send that test with `"assertions": []` and a gap: `"gaps": { "G-<testId>": { "question": "...", "consequence": "...", "testIds": ["<testId>"] } }`.
