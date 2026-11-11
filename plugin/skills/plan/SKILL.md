---
name: plan
description: Create revision 1 of a Checkmate test plan from a recorded plan request. Write tests with explicit assertions, and gaps for unknown behavior.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Use the exact plan ID named by the caller. Run `checkmate plan request <planId>`. Read the current objective, requirements, source context, capabilities, operations, and context/tool instructions. Keep this ID for the save; do not substitute an existing plan with a similar objective.
2. Use the caller's available tools to read the sources named in the context instructions. If access is missing, return `needs_decision`. Do not change the recorded scope from a source document alone.
3. Send a candidate with `tests` and `gaps` directly to `checkmate plan save <planId>` on standard input. Do not save a JSON file.
4. If the command refuses the candidate, correct it and send it again.
5. Run `checkmate plan show <planId>` to read the saved revision. Return the save response. A `needs_decision` status with gap questions is a correct result.

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

- Ground each action and precondition in an interface documented by the caller or an authorized source. Do not invent UI controls, endpoints, or request parameters. If the interface needed for a scenario is unclear, record a blocking gap.
- Keep scenario inputs separate from expected results. A rule about whether a discount applies belongs in an assertion; it does not remove a requested customer, promotion, or loyalty input.
- Cover every requirement with one or more tests. Do not add requirements. Do not broaden the scope.
- Give each test one or more `requirementIds` and one or more `operations`. Use only the target capabilities and allowed operations.
- An assertion is one check with a known expected value. Use `deterministic` for an exact value. Use `agent_observation` for a judgment.
- Do not write an assertion with an unknown expected value. Write an open blocking gap for it. A test with only unknown checks has `"assertions": []`.
- A gap applies to the tests in `testIds` and to every test of the requirements in `requirementIds`. To block one test, name the test and leave `requirementIds` empty.
- Do not write `readiness`, `gapIds`, `coverage`, decisions, or assumptions. Checkmate calculates them.
- Do not run test actions during planning. Do not open the application or call its functional endpoints, even with GET. Read only the caller-authorized tracker and documentation sources for context.
- Do not answer a gap. The caller decides with `checkmate gap answer`.
