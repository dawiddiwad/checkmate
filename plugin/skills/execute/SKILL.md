---
name: execute
description: Execute an approved Checkmate plan revision. Record each assertion result with evidence, close each test, record findings and gaps, and finish the run.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.
Use the caller's existing tools. The browser and HTTP references are optional examples for those specific tools.

## Start

- Delegated stage: the parent has begun the run. The prompt names the run ID, plan revision, selected tests, browser session, and deadline. Do not run `run gate` or `run begin`.
- Same session, new run: run `checkmate run gate <planId@rev> --tests <T1,T2> --build <build>`. Stop when it does not print `completed`. Then run `checkmate run begin <runId> <planId@rev> --tests <T1,T2> --build <build>` once. Add `--retest-of <runId>` for a retest.
- Same session, stalled run: run `checkmate run resume <runId>`. Check only the assertions that it lists. The caller decides about tests marked `Actions may have occurred`.

Then:

1. Run `checkmate run show <runId> --json`. Read the current selected tests, assertions without a result, and temporary `evidenceDirectory`.
2. Run `checkmate plan show <planId@rev> --tests <T1,T2> --fields dependsOn,preconditions,action,assertions`.
3. Run `checkmate target show <targetId@rev>` using the pinned target revision from the run. Read the base URL, tooling, and cleanup instructions.
4. Run `checkmate plan request <planId>` for context and tool instructions. Respect setup restrictions and the plan's narrower restrictions.

## For each selected test

Run prerequisites first. A local `dependsOn` test must pass before the dependent test starts.

1. Do the action of the test with the target's tools. Do not write maintained automation. Do not change the application.
2. For each assertion, write the evidence file first in the returned temporary `evidenceDirectory`, for example `<evidenceDirectory>/T1-A1.txt`. Use one new file for each assertion. Checkmate deletes the file after it stores it.
3. Record the assertion: `checkmate run check <runId> <testId> <assertionId> --result <result> --observed "<what you saw>" --evidence <evidenceDirectory>/T1-A1.txt`. Give the test ID and the assertion ID as two words: for `T1.A1`, write `T1 A1`. The output prints the evidence ID.
4. When each assertion has a result, run `checkmate run close <runId> <testId>`. Checkmate calculates the outcome.
5. For a test that you did not start, run `checkmate run close <runId> <testId> --outcome blocked|not_run|error --reason "<cause>"`. Use `blocked` for a failed prerequisite or a new blocking gap. Use `error` for a tool or access failure.

## Assertion results

- `passed`: you observed the target, and the observation meets the check. Needs `--observed` and `--evidence`.
- `failed`: you observed the target, and the observation contradicts the check. Needs `--observed` and `--evidence`. Each failed assertion needs a defect finding.
- `inconclusive`: you checked the assertion, but the evidence cannot show whether the check is met. Needs `--observed`, `--evidence`, and `--reason` that says what is missing. It is not a defect.
- `not_checked`: you did not check the assertion, for example because an earlier step failed or a tool failed. Needs `--reason` only. The test outcome becomes `error`.

After a failed assertion, check the other assertions that you can still check. Record the others as `not_checked`.
Compare with the exact check text. Do not change the check. Do not call a tool failure a product defect.

## Findings and gaps

Send each finding directly to `checkmate run finding <runId>` on standard input. Do not save a JSON file:

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
- For new ambiguity, write a gap with `"status": "open"` and a new ID. Send it directly to `checkmate run gap <runId>` on standard input.
- After a new blocking gap, stop further actions when the run policy is `return_to_caller`. Close the remaining tests as `blocked`.

## Finish

1. Follow the profile cleanup instructions with the same host tool used for execution. Close only sessions you created. Remove any remaining temporary evidence files.
2. Run `checkmate run finish <runId> --completion <completion> --cleanup <status> --cleanup-reason "<text>"`.
   - `completed`: every selected test is closed, no test is `error`, and cleanup did not fail.
   - `operational_error`: a tool, access, or cleanup failure stopped the run.
   - `interrupted`: the deadline is near. Finish before the deadline.
3. Run `checkmate run show <runId>` again. Return the response of `run finish`.

A retest is a new run with a new build. Do not change the prior run. A narrow retest does not give full coverage.
