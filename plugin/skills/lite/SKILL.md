---
name: lite
description: Test a change freely and record the result in Checkmate in a few batch calls. Use when the prompt tells you to record with the Checkmate lite skill. Before the build, record a checklist and questions. After each build, read the answers, test, and record the full build in one call.
---

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. When `checkmate` is on PATH, you can use it directly. Add `--actor claude:lite` to each write.

Send each JSON payload on standard input in a quoted heredoc. Do not write payload files:

```bash
checkmate lite record <planId> --build b1 --actor claude:lite <<'EOF'
{"checks": [...]}
EOF
```

Checkmate is the record, not the test method. Test freely with the app, the API, the docs, and your judgment. Then record what you did.

## Before the build

1. Study the ticket, the docs, and the running app.
2. Write the checklist: the rules and acceptance criteria to check. Give each item an ID (`R1`, `R2`, ...), the rule text, and the source (file and section). Add the existing rules that the change can break. These are the regression items.
3. Write one question for each unclear point. Give each question an ID (`Q1`, `Q2`, ...) and the items that it affects.
4. Record the checklist and the questions in one call:

```bash
checkmate lite checklist <planId> --target <targetId@revision> --actor claude:lite <<'EOF'
{"objective": "<what to verify>", "items": [{"id": "R1", "text": "<rule>", "source": "ticket.md#<section>"}], "questions": [{"id": "Q1", "question": "<question>", "items": ["R1"]}]}
EOF
```

Do not test the change before the build.

## Each build

1. Run `checkmate lite show <planId>`. It shows the items, each question with its answer, the runs, and the open defects (`open_defect` lines).
2. Test the build freely. Check each item. Look for edge cases outside the checklist. Check the items of each open defect again.
3. Keep evidence. Save screenshots and logs as files in the workspace, or keep short text.
4. Record the full build in one call: `checkmate lite record <planId> --build <build> --actor claude:lite` with the JSON below.
5. When Checkmate refuses, read `reason:` and `hint:`. Correct the JSON. Send the full call again. Checkmate records nothing until the call completes.

```json
{
	"items": [{ "id": "R9", "text": "<rule that exploration found>", "source": "exploration" }],
	"checks": [
		{
			"item": "R1",
			"check": "<what you checked>",
			"result": "passed",
			"observed": "<what you saw>",
			"evidence": ["shots/r1.png"]
		},
		{
			"item": "R2",
			"check": "<what you checked>",
			"result": "failed",
			"observed": "<what you saw>",
			"evidence": [{ "text": "<response body>" }],
			"defect": "D1"
		},
		{ "item": "R3", "check": "<what you checked>", "result": "blocked", "reason": "<why the check did not run>" }
	],
	"defects": [
		{
			"id": "D1",
			"title": "<title>",
			"severity": "high",
			"steps": ["<step>", "<step>"],
			"expected": "<expected>",
			"actual": "<actual>",
			"evidence": ["shots/d1.png"]
		}
	],
	"retests": [{ "defect": "D1", "verdict": "fixed", "observed": "<what you saw>", "evidence": ["shots/d1-b2.png"] }],
	"questions": [{ "id": "Q3", "question": "<new question>", "items": ["R2"] }]
}
```

## Rules

- Give each item one or more checks.
- The result is `passed`, `failed`, `blocked`, or `not_run`. A passed or failed check needs `observed`. A blocked or not_run check needs a `reason`.
- A failed check names its defect in `defect`. Each defect needs one or more failed checks and one or more evidence items.
- When no item covers a defect, add an item in `items` and a failed check for it.
- Evidence is a file path relative to the workspace, or `{"text": "<what you saw>"}`.
- Give each new defect a new ID. Do not record an earlier defect again.
- On a later build, give each open defect a verdict in `retests`: `fixed` or `not_fixed`, with `observed` and evidence. A failed check that shows a not-fixed defect names the earlier ID in `defect`.
- Leave out `items`, `defects`, `retests`, and `questions` when you have none. Ask only new questions.
- The oracle answers the questions and accepts each build record. Do not answer or accept them yourself.
