---
name: lite
description: Test a change freely and record the result in Checkmate in a few batch calls. Use when the prompt tells you to record with the Checkmate lite skill. Before the build, record a checklist, baselines, and questions. After each build, read the answers, test, and record the build in parts.
---

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. When `checkmate` is on PATH, you can use it directly. Add `--actor claude:lite` to each write.

Lite mode uses only `lite checklist`, `lite show`, and `lite record`. Do not use other Checkmate commands.

Send each JSON payload on standard input in a quoted heredoc. Do not write payload files:

```bash
checkmate lite record <planId> --build b1 --actor claude:lite <<'EOF'
{"checks": [...]}
EOF
```

Checkmate is the record, not the test method. Test freely with the app, the API, the docs, and your judgment. Then record what you did.

## Before the build

The base app is running. It does not have the change.

1. Study the ticket and the docs.
2. Write one item for each numbered acceptance criterion of the ticket. Give it `"criterion": <number>` and the ticket file as `source`. Do not merge two criteria in one item. Set `"criteria"` to the count of numbered criteria (0 when the ticket has none).
3. Add the existing rules that the change can break. These are the regression items. Look for rules near the change:
   - the same totals or calculations,
   - the same validation and error messages,
   - lists, exports, and counters that show the changed data,
   - permissions,
   - the rules in the docs for the same page or endpoint.
4. Give each regression item a baseline from the base app: the exact request or UI steps, the value that you saw, and the value that the docs state. Use a short exact value, for example `409 "Room is taken"` or `total 43.20`. Keep this step short: one request or a few steps for each item, not a test run. When the base value and the docs differ, add a question.
5. Write one question for each unclear point, with the items that it affects.
6. Record all of it in one call:

```bash
checkmate lite checklist <planId> --target <targetId@revision> --actor claude:lite <<'EOF'
{"objective": "<what to verify>", "criteria": 2, "items": [
 {"id": "R1", "text": "<criterion 1>", "source": "ticket.md", "criterion": 1},
 {"id": "R2", "text": "<criterion 2>", "source": "ticket.md", "criterion": 2},
 {"id": "R3", "text": "<existing rule>", "source": "docs/<file>#<section>",
  "baseline": {"steps": "<exact request or steps>", "value": "<value on base>", "documented": "<value in the docs>"}}],
 "questions": [{"id": "Q1", "question": "<question>", "items": ["R1"]}]}
EOF
```

Do not test the change before the build.

## Each build

1. Run `checkmate lite show <planId>`. It shows the items, the reference values (`repeat` lines), each question with its answer, the runs, and the open defects (`open_defect` lines).
2. Test the build freely. Check each criterion item. Look for edge cases outside the checklist. Check the items of each open defect again.
3. For each `repeat` line, do its steps again exactly. Put the value that you see in `"value"` and leave out `"result"` and `"check"`: Checkmate uses the steps of the line, compares the value with the reference value, and sets the result. When the values are different, add `"defect"` when the new value is wrong, or `"intended": {"note": "<why>", "source": "<ticket line or answer>"}` when the ticket or an answer changes the rule. When the difference is not in the rule, for example a generated ID or data that your tests changed, add `"result"` and `"reason"`.
4. Keep evidence. Save screenshots and logs as files in the workspace, or keep short text.
5. Save a first draft early: `checkmate lite record <planId> --build <build> --draft --actor claude:lite` with the JSON below. Add parts with `--draft` while you test. A part replaces an earlier part with the same ID, or a check with the same item and check.
6. Complete the build with a last call without `--draft`, with the last parts or `{}`. Checkmate checks the full record.
7. When Checkmate refuses, read each `reason:` and `hint:`. A refused call saves nothing, but the drafts stay. Send again only the parts of the refused call, with the fixes.

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
			"evidence": ["<response line that you saw>"],
			"defect": "D1"
		},
		{ "item": "R3", "value": "<value>" },
		{ "item": "R9", "check": "<what you checked>", "result": "blocked", "reason": "<why the check did not run>" }
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

- Give each item one or more checks on each build. A criterion item needs a check that is passed, failed, or blocked. An item with a `repeat` line needs a check with `value`, or a blocked check with a `reason`.
- The result is `passed`, `failed`, `blocked`, or `not_run`. A passed or failed check needs `observed`. A blocked or not_run check needs a `reason`.
- A failed check names its defect in `defect`. Each defect needs one or more failed checks and one or more evidence items.
- When no item covers a defect, add an item in `items` and a failed check for it.
- Evidence is a file path relative to the workspace, or a short text of what you saw. One file can be the evidence of several checks.
- Give each new defect a new ID. Do not record an earlier defect again.
- On a later build, give each open defect a verdict in `retests`: `fixed` or `not_fixed`, with `observed` and evidence. A failed check that shows a not-fixed defect names the earlier ID in `defect`.
- Leave out `items`, `defects`, `retests`, and `questions` when you have none. Ask only new questions.
- The oracle answers the questions and accepts each build record. Do not answer or accept them yourself.
