---
name: execute
description: Execute an approved Checkmate plan revision. Record each assertion result with evidence, close each test, record findings and gaps, and finish the run.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.
Read `${CLAUDE_PLUGIN_ROOT}/references/browser.md` and `${CLAUDE_PLUGIN_ROOT}/references/http.md` as needed.

## Start

- Delegated stage: the parent has begun the run. The prompt names the run ID, plan revision, selected tests, browser session, and deadline. Do not run `run gate` or `run begin`.
- Same session, new run: run `checkmate run gate <planId@rev> --tests <T1,T2> --build <build>`. Stop when it does not print `completed`. Then run `checkmate run begin <runId> <planId@rev> --tests <T1,T2> --build <build>` once. Add `--retest-of <runId>` for a retest.
- Same session, stalled run: run `checkmate run resume <runId>`. Check only the assertions that it lists. The caller decides about tests marked `Actions may have occurred`.

Then:

1. Run `checkmate run show <runId>`. It lists the selected tests and the assertions without a result.
2. Run `checkmate plan show <planId@rev> --tests <T1,T2> --fields dependsOn,preconditions,action,assertions`.
3. Run `checkmate target show <targetId>` when you need the base URL or the tools.

## For each selected test

Run prerequisites first. A local `dependsOn` test must pass before the dependent test starts.

1. Do the action of the test with the target's tools. Do not write maintained automation. Do not change the application.
2. For each assertion, record the result with text evidence on standard input. Give the test ID and the assertion ID as two words: for `T1.A1`, write `T1 A1`. The output prints the evidence ID.

```sh
checkmate run check <runId> T1 A1 --result passed --observed "<what you saw>" --evidence - <<'EOF'
<the page text or the JSON exchange that shows the observation>
EOF
```

3. Checkmate stores JSON text as `application/json` and other text as `text/plain`. Add a kind when it is not an observation, for example `--evidence -:http_exchange`.
4. For binary evidence, for example a screenshot, write one new file in `.checkmate/tmp/<runId>/`. Add `--evidence .checkmate/tmp/<runId>/T1-A1.png`. Checkmate deletes the file after it stores it. You can give one text and one or more files.
5. When each assertion has a result, run `checkmate run close <runId> <testId>`. Checkmate calculates the outcome.
6. For a test that you did not start, run `checkmate run close <runId> <testId> --outcome blocked|not_run|error --reason "<cause>"`. Use `blocked` for a failed prerequisite or a new blocking gap. Use `error` for a tool or access failure.

## Assertion results

- `passed`: you observed the target, and the observation meets the check. Needs `--observed` and `--evidence`.
- `failed`: you observed the target, and the observation contradicts the check. Needs `--observed` and `--evidence`. Each failed assertion needs a defect finding.
- `inconclusive`: you checked the assertion, but the evidence cannot show whether the check is met. Needs `--observed`, `--evidence`, and `--reason` that says what is missing. It is not a defect.
- `not_checked`: you did not check the assertion, for example because an earlier step failed or a tool failed. Needs `--reason` only. The test outcome becomes `error`.

After a failed assertion, check the other assertions that you can still check. Record the others as `not_checked`.
Compare with the exact check text. Do not change the check. Do not call a tool failure a product defect.

## Findings and gaps

Send each finding in a heredoc: `checkmate run finding <runId> <<'EOF'`, the JSON, then `EOF`. Use this shape:

```json
{
	"id": "F1",
	"type": "defect",
	"severity": "medium",
	"assertionIds": ["T2.A1"],
	"requirementIds": ["R2"],
	"title": "Promotion stacks with loyalty",
	"expected": "totalPLN equals 240.",
	"observed": "totalPLN is 220.",
	"reproduction": ["GET /quote?promotion=true&loyalty=true"],
	"evidenceIds": ["<evidence ID printed by run check>"]
}
```

- Give every field of the example. `requirementIds` are the requirements of the named tests.
- A `defect` names only failed assertions. Use `potential_issue` for a suspicion, for example with an inconclusive assertion.
- For new ambiguity, write a gap with `"status": "open"` and a new ID. Send it in a heredoc: `checkmate run gap <runId> <<'EOF'`, the JSON, then `EOF`.
- After a new blocking gap, stop further actions when the run policy is `return_to_caller`. Close the remaining tests as `blocked`.

## Finish

1. Close the browser session: `playwright-cli -s=<browserSession> close`.
2. Run `checkmate run finish <runId> --completion <completion> --cleanup <status> --cleanup-reason "<text>"`.
   - `completed`: every selected test is closed, no test is `error`, and cleanup did not fail.
   - `operational_error`: a tool, access, or cleanup failure stopped the run.
   - `interrupted`: the deadline is near. Finish before the deadline.
3. Return the response of `run finish`.

A retest is a new run with a new build. Do not change the prior run. A narrow retest does not give full coverage.
