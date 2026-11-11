---
name: plan
description: Create revision 1 of a Checkmate test plan from a recorded plan request. Write tests with explicit assertions, and gaps for unknown behavior.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Run `checkmate plan request <planId>`. It prints the objective, requirements, source context, target capabilities, and allowed operations.
2. Write a candidate with `tests` and `gaps` only. Use the shape below.
3. Send the candidate in a heredoc: `checkmate plan save <planId> <<'EOF'`, the JSON, then `EOF`.
4. If the command refuses the candidate, correct it and run step 3 again.
5. Return the response of `plan save`. A `needs_decision` status with gap questions is a correct result.

```json
{
	"tests": [
		{
			"id": "T1",
			"title": "Standard order total",
			"requirementIds": ["R1"],
			"capability": "browser",
			"operations": ["create_fixture_order"],
			"dependsOn": [],
			"preconditions": ["Fresh cart with one item."],
			"action": "Complete checkout and read the confirmation.",
			"assertions": [{ "id": "A1", "check": "The confirmation shows 400 PLN.", "oracleKind": "agent_observation" }]
		}
	],
	"gaps": [
		{
			"id": "G1",
			"severity": "blocking",
			"status": "open",
			"requirementIds": [],
			"testIds": ["T2"],
			"question": "Does the promotion stack with the loyalty discount?",
			"consequence": "The expected total is unknown.",
			"decisionId": null
		}
	]
}
```

Rules:

- Cover every requirement with one or more tests. Do not add requirements. Do not broaden the scope.
- Give each test one or more `requirementIds` and one or more `operations`. Use only the target capabilities and allowed operations.
- An assertion is one check with a known expected value. Use `deterministic` for an exact value. Use `agent_observation` for a judgment.
- Do not write an assertion with an unknown expected value. Write an open blocking gap for it. A test with only unknown checks has `"assertions": []`.
- A gap applies to the tests in `testIds` and to every test of the requirements in `requirementIds`. To block one test, name the test and leave `requirementIds` empty.
- Do not write `readiness`, `gapIds`, `coverage`, decisions, or assumptions. Checkmate calculates them.
- Do not run test actions during planning. Do not open the application.
- Do not answer a gap. The caller decides with `checkmate gap answer`.
