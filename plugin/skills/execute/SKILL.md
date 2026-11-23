---
name: execute
description: Run the stored tests of a Checkmate run ID such as run-1, or retest that run on a new build. Use when the test skill hands over a run, or the oracle names a run or a plan revision to run.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

The prompt names the run ID, the instance, the selected tests, the browser session, and the deadline. The parent began the run. Do not run `run gate` or `run begin`.

## Start

1. Run `checkmate run show <runId>`. Note the selected tests, each `retest` line, and `onNewBlocker`.
2. Run `checkmate plan show <planId@rev> --tests <selected> --fields dependsOn,preconditions,action,assertions`.
3. Run `checkmate target show <targetId> --instance <instanceId>`. Use its `url` entry for every action.

## Each test

Run the `retest` tests first. Then run the other tests. Each test runs after its `dependsOn` tests. After each test, whatever its result, go to the next test. Do not stop the run while a selected test is still open. Do not search the file system. The prompt names the source files. Read them with the read tool. For each test:

1. Run `checkmate run show <runId> --tests <testId>`. When the `time` line shows 90% or more of the deadline used, go to Finish.
2. When a `dependsOn` test did not pass, close this test as `blocked`: `checkmate run close <runId> <testId> --actor claude:execute --outcome blocked --reason "Prerequisite T2 is blocked"`. Go to the next test.
3. Do the action of the test. Use the recipe below for each tool.
4. Record each assertion. See Record results.
5. Close the test: `checkmate run close <runId> <testId> --actor claude:execute`.

When a tool fails, or the action cannot run, do not close the test without trying the action. Run the action once. Then close the test as `error`. Give the output of the failed tool as evidence:

```sh
checkmate run close <runId> <testId> --actor claude:execute --outcome error --reason "Browser did not open the page" --evidence - <<'EOF'
<the output of the failed command>
EOF
```

An `error` close needs evidence. A close without evidence is refused.

When a new blocking question appears, record a gap and close the test as `blocked`. Then go to the next test.

## Recipes

Use the `url` entry of the instance. Replace the example URL with it.

Browser (plan tool `playwright-cli`). Use the browser session that the prompt names:

```sh
PLAYWRIGHT_MCP_OUTPUT_DIR=.checkmate/tmp/<runId> playwright-cli -s=<browserSession> open <url>
playwright-cli -s=<browserSession> snapshot
```

`snapshot` prints the page text. Use that text as the observed value and the evidence. Use `playwright-cli -s=<browserSession> click <ref>` only when the test action needs a click. Close the session at the end of the run.

HTTP (plan tool `node`). Call the endpoint that the test needs. Replace the path and the query with the ones of the test. Print the status and the body:

```sh
node --input-type=module -e 'const r = await fetch("<url>/api/quote?sku=kettle&qty=0", { signal: AbortSignal.timeout(10000) }); console.log(JSON.stringify({ status: r.status, body: await r.text() }))'
```

Use the printed line as the evidence. Add `--evidence -:http_exchange` when you record it.

A tool that is listed as on PATH is available. Run it. Do not report it as missing before you run it once.

## Record results

```sh
checkmate run check <runId> T1 A1 --actor claude:execute --result passed --observed "<observed value>" --evidence - <<'EOF'
<the tool output, copied>
EOF
```

Give the test ID and the assertion ID as two words: `T1 A1`.

1. Write the expected value from the check text. Write the observed value from the tool output. Compare them literally.
2. When they match, record `passed`.
3. When they differ, record `failed`. Do not record `passed` for a check that contains a value you did not see.
4. When you could not observe the value, record `not_checked` with `--reason`. The test becomes `error`.
5. Keep the observed value short and exact, for example `Price: 300 PLN`.

Each assertion checks one expected value. When an assertion has two expected values, compare each one. Record `failed` when any value differs.

Record a defect finding for each failed assertion. Send it on standard input:

```sh
checkmate run finding <runId> --actor claude:execute <<'EOF'
{"id":"F1","type":"defect","severity":"medium","assertionIds":["T2.A1"],"requirementIds":["R2"],"title":"Quantity 0 is accepted","expected":"HTTP 400","observed":"HTTP 200","reproduction":["GET /api/quote?sku=kettle&qty=0"],"evidenceIds":["<evidence ID printed by run check>"]}
EOF
```

Use `potential_issue` for a suspicion. It can leave `assertionIds`, `requirementIds`, and `evidenceIds` empty.

For a new ambiguity, record a gap on standard input: `checkmate run gap <runId> --actor claude:execute`. Use an ID that the plan does not have, for example `RG1`. Set `"testIds"` to the affected tests.

## Retest

A retest prints one `retest` line for each open defect of the earlier runs. Run those tests first. Run each one to `passed` or `failed`. When a precondition fails, adapt the test data. Do not close it as `blocked` for data. When it fails again, record a new defect finding in this run.

## Exploration

After the selected tests, probe the rules of the selected tests for a few cases the plan does not check. Use at most 10 probe actions. Stop when 75% of the deadline is used. Record a `potential_issue` only when a probe contradicts a source or a check. Record nothing for a probe that shows correct behavior. Skip this section for a permanent run.

## Finish

1. When you used the browser, run `playwright-cli -s=<browserSession> close`.
2. Run `checkmate run finish <runId> --actor claude:execute --completion <completed|operational_error|interrupted> --cleanup <completed|failed|not_applicable> --cleanup-reason "<text>"`.
   - `completed`: every selected test is closed, and none is `error`.
   - `operational_error`: every selected test is closed first. Use it when tools failed for all tests. A test that failed for a tool closes as `error` with the tool output as evidence.
   - `interrupted`: only when the deadline is used up, the host stopped the run, or a tool that every test needs is missing. Add `--cause deadline|host_stopped|tool_unavailable --reason "<text>"`.
   - A blocking gap closes only its tests. It does not finish the run.
3. Return the status and the reasons of the `run finish` output.

## Test data

Each test owns its data. Use `qa-<runId>-<testId>` for a unique value. Do not change the application, its code, or its configuration. Do not run a command that the plan does not allow. Checkmate runs the recorded reset before the run begins. Do not run a reset yourself.
