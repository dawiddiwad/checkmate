---
name: execute
description: Execute an approved Checkmate plan revision. Record each assertion result with evidence, close each test, record findings and gaps, and finish the run.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`. It has the command rules, the actor rules, and the report format.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

Use the tools of the plan. `checkmate plan request <planId>` lists them. Each tool has a name, a kind (`cli`, `mcp`, or `skill`), and a purpose. The host gives the permission to use a tool. The references `browser.md` and `http.md` are optional recipes for `playwright-cli` and `node`. Read one only when the plan uses that tool.

## Start

- Delegated stage, or a sub-agent that gets a run ID: the parent has begun the run. The prompt names the run ID, plan revision, instance, selected tests, browser session, and deadline. Do not run `run gate` or `run begin`.
- Same session, new run:
  1. Run `checkmate run gate <planId@rev> --tests <T1,T2> --build <build>`. When it does not print `completed`, stop and report the `reason:` lines to the oracle.
  2. Use the oracle's run ID. When the oracle gives none, run `checkmate run list` and use the next free `run-<n>`.
  3. Run `checkmate run begin <runId> <planId@rev> --tests <T1,T2> --build <build> --instance <instanceId>` once. Use the instance that the oracle names. You can leave out `--instance` only when the target has one active instance. Add `--retest-of <runId>` for a retest. It prints the browser session and the evidence directory. When it does not print `completed`, no run exists. Stop and report the `reason:` lines.

  For an early run while gaps are open, or when the oracle asks for the ready tests, give `--partial ready_only` and no `--tests` to `run gate` and `run begin`. Checkmate selects the ready tests. It prints `tests=<selection>` and a `<testId> left_out <reason>` line for each other test.

- Same session, stalled run: run `checkmate run resume <runId>`. Check only the assertions that it lists. The oracle decides about tests marked `Actions may have occurred`.

Then:

1. Run `checkmate run show <runId>`. It lists the selected tests and the assertions without a result.
2. Run `checkmate plan show <planId@rev> --tests <T1,T2> --fields dependsOn,preconditions,action,assertions`.
3. Run `checkmate plan request <planId>` for the tools.
4. Read the instance of the run: `checkmate target show <targetId> --instance <instanceId>`. `run show` prints the instance. The output has one `entry` line for each entry point.

## Instance entries

Use the entry values of the run instance for every action. Do not use another instance.

- `url`: open or call this URL.
- `value`: use the value as it is, for example an org alias in `--target-org <alias>`.
- Run a `command` entry exactly as recorded and alone. Do not edit it, chain it, or pipe it into other commands. Stop and record a `blocked` gap when the command would change state outside `allowedOperations`, when the host refuses the permission, or when the command fails. Do not work around a refusal.
- `command`: run the command at test time, before the action that needs it. Use its output, for example a one-time login URL. Do not record the output as an entry value. Do not put a login URL, a token, or other secret output in evidence.

`references` name authentication aliases or environment variables. The host resolves them. Do not record their values.

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
- After a new blocking gap, apply the new blocker policy of the run. A delegated prompt names it. Else read `request.onNewBlocker` from `checkmate run show <runId> --json`. `return_to_oracle`: stop further actions, and close the remaining tests as `blocked`. `continue_independent`: continue the tests that the gap does not affect, and close the affected tests as `blocked`.

## Finish

1. When the run used a browser, close the browser session: `playwright-cli -s=<browserSession> close`.
2. Run `checkmate run finish <runId> --completion <completion> --cleanup <completed|failed|not_applicable> --cleanup-reason "<text>"`. Use `not_applicable` when the run needs no cleanup.
   - `completed`: every selected test is closed, no test is `error`, and cleanup did not fail.
   - `operational_error`: a tool, access, or cleanup failure stopped the run.
   - `interrupted`: the deadline is near. Finish before the deadline.
3. Return the response of `run finish`.
4. In the same session, report to the oracle in the format of `workflow.md`. Show the tests (Test, Outcome, Reason) and the findings. In `Next:`, name the result decision: `checkmate result accept|reject <runId> --rationale "<why>"`, or the review UI. Name a retest or a gap answer when one is necessary. For a new gap of the run, name `checkmate gap answer <planId> <gapId> ...`. It adopts the gap into the plan and records the answer.

A retest is a new run with a new build. Do not change the prior run. A narrow retest does not give full coverage.
