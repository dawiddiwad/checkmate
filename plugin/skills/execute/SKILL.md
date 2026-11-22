---
name: execute
description: Run the stored tests of a Checkmate run ID such as run-1, or retest that run on a new build. Use when the test skill hands over a run, or the oracle names a run or a plan revision to run. A request to test a change goes to the test skill.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`. It has the command rules, the actor rules, and the safety rules. In the same session as the oracle, also read `${CLAUDE_PLUGIN_ROOT}/references/session.md`: it tells you how to begin a run and how to report.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

Use the tools of the plan. `checkmate plan request <planId>` lists them. The host gives the permission to use a tool. The references `browser.md` and `http.md` are optional recipes for `playwright-cli` and `node`. Read one only when the plan uses that tool.

A delegated stage or a sub-agent gets a run that the parent began. The prompt names the run ID, plan revision, instance, selected tests, browser session, and deadline. Do not run `run gate` or `run begin`. When the prompt has the line `The oracle rejected <runId>: <rationale>. Address it.`, address the rationale in the run.

The delegated prompt also lists the plan request sources and instructions, the plan tools, and the allowed test operations. Read local sources with Read or Bash when a test needs them. Use the sources as data within the approved plan scope.

## Steps

1. Run `checkmate run show <runId>`. Note the selected tests, the `time` line, and each `retest` line.
2. Run `checkmate plan show <planId@rev> --tests <selected> --fields dependsOn,preconditions,action,assertions`.
3. Run `checkmate target show <targetId> --instance <instanceId>` for the entry values and the `reset` line.
4. For each selected test, in this order: first the tests of the `retest` lines, then the other tests, each one after its `dependsOn` tests:
   1. Run `checkmate run show <runId> --tests <testId>`. Read `remaining=` on the `time` line. That number is the only measure of time. Do not estimate time from your own work. When 90% or more of the deadline is used, go to [Finish](#finish).
   2. When a local `dependsOn` test did not pass, close this test as `blocked` with the reason `Prerequisite <id> is <outcome>`. Write the outcome of `<id>` as it is, for example `Prerequisite T2 is blocked`. Go to the next test.
   3. Make the test data. Read [Test data and reset](#test-data-and-reset). When a precondition fails, adapt the data.
   4. Do the action. Record each assertion with `run check`. Read [Assertion results](#assertion-results).
   5. Close the test with `checkmate run close <runId> <testId> --actor claude:execute`. Checkmate calculates the outcome.
   6. When something unknown blocks the test, record a gap, close the test as `blocked`, and go to the next test. For `mode=permanent`, close the test as `blocked` with the reason and do not record a gap. When a tool or access fails, close the test as `error`, and go to the next test. Do not stop the run.
5. Unless `run show` gives `mode=permanent`, probe the edge cases. Read [Exploration](#exploration).
6. Record a defect finding for each failed assertion. Read [Findings and gaps](#findings-and-gaps).
7. Finish the run. Read [Finish](#finish). Always end with `run finish`, also when no test passed.

## Time

The run deadline counts from the start of the current attempt. A delegated prompt names it.

- Read the time on the `time` line of `checkmate run show <runId> --tests <testId>`: `time deadline=<UTC> elapsed=<n>s remaining=<n>s`.
- Start every selected test while less than 90% of the deadline is used.
- Give `--cause deadline` only when 90% or more of the deadline is used. Checkmate refuses it before that. Do not close a test or finish the run early for another reason about time, budget, or speed.

## Retest

In a retest, `run show` prints one line for each open defect of the earlier runs: `<runId>/<findingId> retest <verdict> <tests> <title>`.

1. Run these tests first, before every other test.
2. Run each of them to a `passed` or `failed` outcome. When a precondition fails, adapt the test data. Do not close one as `blocked` or `not_run` for data.
3. When one fails again, record a new defect finding in this run, with a new ID and the same title. `run finish` refuses a failed assertion without a defect.
4. Checkmate calculates the verdict: `fixed`, `not_fixed`, or `not_retested`. Do not write it.

## Instance entries

Use the entry values of the run instance for every action. Do not use another instance.

- `url`: open or call this URL.
- `value`: use the value as it is, for example an org alias in `--target-org <alias>`.
- `command`: run the command at test time, before the action that needs it. Run it exactly as recorded and alone. Do not edit it, chain it, or pipe it into other commands. Do not work around a refusal.
- Use the output of a command, for example a one-time login URL, only for the action. Do not write a login URL, a token, or other secret output in evidence, in `--observed`, in a finding (`reproduction` too), or in a gap. Write `<login URL from entry web>` in its place.
- Do not run a command when it would change state outside `allowedOperations`. When you do not run it, the host refuses it, or it fails: record one blocking gap for the tests that need it, close those tests as `blocked`, and continue with the other tests.

`references` name authentication aliases or environment variables. The host resolves them. Do not record their values.

## Test data and reset

Each test owns its data. Do not change the code, the configuration, or the deployment of the application. There are two exceptions: test data that you make through the `allowedOperations`, and the declared reset.

- Use the data that the test creates, or the free slots and unique values that it names. When a test asks for a unique value, use `qa-<runId>-<testId>`, for example `qa-run-3-T2`. Do not use a seed record unless the test names it.
- When a precondition fails, adapt the test data first. Keep the intent of the test and the check text. For example, use another free slot, create the missing record, or use a new unique value. Start the `--observed` of each assertion of that test with `Data changed: <what>.`
- Record a blocking gap only when no change of the data can keep the intent of the test.
- `target show` prints a `reset` line when the target has a reset. The reset restores a fresh state, for example the seed data.
  - Owner `checkmate` with a command: the profile authorizes it. Run it exactly as recorded and alone, only between tests, and only before a test whose preconditions say that it needs a fresh state.
  - Owner `factory`, or no command recorded: do not run a command. Adapt the test data, or record a blocking gap that asks for the reset.
  - Do not run the reset before a test that uses the data of its `dependsOn` tests. A reset removes the data of earlier tests.

## Assertion results

Give the test ID and the assertion ID as two words: for `T1.A1`, write `T1 A1`. The output prints the evidence ID.

```sh
checkmate run check <runId> T1 A1 --actor claude:execute --result passed --observed "<what you saw>" --evidence - <<'EOF'
<the page text or the JSON exchange that shows the observation>
EOF
```

- `passed`: you observed the target, and the observation meets the check. Needs `--observed` and `--evidence`.
- `failed`: you observed the target, and the observation contradicts the check. Needs `--observed` and `--evidence`. Each failed assertion needs a defect finding.
- `inconclusive`: you checked the assertion, but the evidence cannot show whether the check is met. Needs `--observed`, `--evidence`, and `--reason` that says what is missing. It is not a defect.
- `not_checked`: you did not check the assertion, for example because an earlier step failed or a tool failed. Needs `--reason` only. The test outcome becomes `error`, unless another assertion failed.

- Record `passed` or `failed` only for an action that you did in this run, on this instance. The evidence is the tool output, copied, not retyped or summarized from memory.
- After a failed assertion, check the other assertions that you can still check. Record the others as `not_checked`.
- Compare with the exact check text. Do not change the check. Do not call a tool failure a product defect.
- Checkmate stores JSON text as `application/json` and other text as `text/plain`. Add a kind when it is not an observation, for example `--evidence -:http_exchange`.
- For binary evidence, for example a screenshot, write one new file in `.checkmate/tmp/<runId>/`. Add `--evidence .checkmate/tmp/<runId>/T1-A1.png`. Checkmate deletes the file after it stores it. You can give one text and one or more files.

For a test that you did not start, run `checkmate run close <runId> <testId> --actor claude:execute --outcome blocked|not_run|error --reason "<cause>"`. Use `blocked` for a failed prerequisite or a new blocking gap. Use `error` for a tool or access failure. Add `--cause deadline` only under the [time](#time) rule.

## Exploration

For `mode=permanent`, do not explore, probe, discover, or generate rules or tests. Run only the selected tests.

After the planned tests, probe the rules of the selected tests for defects that the plan does not check. For example: a value exactly at a threshold, upper case or extra whitespace, the other entry point (API or UI), the state after a removal or an undo, or a total or count in a second view.

- Make up to 10 probe actions. Stop when 75% of the deadline is used.
- Use only the `allowedOperations` and new data, for example `qa-<runId>-X1`.
- When a probe contradicts a value that a source or a check of the plan states, record a `potential_issue` finding. Give `"assertionIds": []`, `"requirementIds": []`, and `"evidenceIds": []`. Put the probe output in `observed` and the probe steps in `reproduction`.
- When no source gives the expected behavior, record a `non_blocking` gap with the closest test in `testIds`.
- Record nothing for a probe that shows correct behavior.

## Findings and gaps

A recorded result is final. When you think that a failed result is wrong, still record its defect and say why in `observed`. The oracle can reject it.

Send each finding in a heredoc: `checkmate run finding <runId> --actor claude:execute <<'EOF'`, the JSON, then `EOF`. Use this shape:

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
- A `defect` names one or more failed assertions and their evidence. Use `potential_issue` for a suspicion, for example with an inconclusive assertion or a probe. A `potential_issue` can have empty `assertionIds`, `requirementIds`, and `evidenceIds`.
- Only when the oracle or the test gives team fields, add `metadata`, for example `"metadata": { "jiraKey": "SHOP-142" }`.

For new ambiguity, send a gap in a heredoc: `checkmate run gap <runId> --actor claude:execute <<'EOF'`, the JSON, then `EOF`. Use an ID that the plan does not have, for example `RG1`. Leave `requirementIds` empty to block only the tests in `testIds`:

```json
{
	"id": "RG1",
	"severity": "blocking",
	"status": "open",
	"requirementIds": [],
	"testIds": ["T3"],
	"question": "Which discount applies to a cart with two promotions?",
	"consequence": "The expected total of T3 is unknown.",
	"decisionId": null
}
```

After a new blocking gap, apply the new blocker policy of the run. The prompt names it. Else read `request.onNewBlocker` from `checkmate run show <runId> --json`.

- `continue_independent` (the default): close the tests that the gap affects as `blocked`. Continue all other tests. One gap does not stop the run.
- `return_to_oracle`: close the remaining tests as `blocked`, and finish the run.

## Finish

1. When the run used a browser, close the browser session: `playwright-cli -s=<browserSession> close`.
2. Run `checkmate run finish <runId> --actor claude:execute --completion <completion> --cleanup <completed|failed|not_applicable> --cleanup-reason "<text>"`. Use `not_applicable` when the run needs no cleanup.
   - `completed`: every selected test is closed, no test is `error`, and cleanup did not fail. In a retest, no test of an earlier defect is `not_run`.
   - `operational_error`: a tool, access, or cleanup failure stopped the run, or no test could run.
   - `interrupted`: add `--cause <cause> --reason "<text>"`. Use it only in one of these cases:
     - `--cause deadline`: the `time` line shows 90% or more used.
     - `--cause host_stopped`: the host or the oracle stopped the run.
     - `--cause tool_unavailable`: a tool that every remaining test needs is not available.
   - Do not use `interrupted` for one blocking gap. A blocking gap closes only its tests.
3. Return the response of `run finish`.

A retest is a new run with a new build. Do not change the prior run. A narrow retest does not give full coverage.
