# Commands

> **Reference** · Every command, its input and output, the statuses, the loop states, `delegate`, and `ui`.

Checkmate has one command set with two entry points. Small values go in flags, structured payloads go in JSON on standard input, and line 1 of every response is the status.

**On this page:** [Entry points](#entry-points) · [Command list](#command-list) · [Read the state](#read-the-state) · [Loop states](#loop-states) · [Input](#input) · [Output](#output) · [Statuses and exit codes](#statuses-and-exit-codes) · [Run gate and policy](#run-gate-and-policy) · [delegate](#delegate) · [ui](#ui) · [Environment variables](#environment-variables)

## Entry points

| Entry point | Command                                  | Has                             |
| ----------- | ---------------------------------------- | ------------------------------- |
| Plugin      | `node "<plugin root>/dist/checkmate.js"` | Every command except `delegate` |
| npm CLI     | `checkmate` from `@xoxoai/checkmate`     | Every command and `delegate`    |

The skills run the plugin CLI with its absolute path. Claude Code gives the path to a skill when it loads the skill. The plugin has no npm dependencies and no global `checkmate` command.

Every command takes `--workspace <path>` and `--json`. Put options after the command name, for example `checkmate plan list --workspace ../app`. The workspace is the current directory by default. A write takes `--actor <name>`.

`checkmate --help` prints every command with its options. `checkmate --version` prints the npm CLI version.

## Command list

| Group     | Command                                                 | Does                                                            |
| --------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| State     | `init`                                                  | Creates `.checkmate/checkmate.db`. Any command does this too.   |
|           | `inbox`                                                 | Lists what waits for the oracle.                                |
|           | `status <planId>`                                       | Prints the loop state of one plan.                              |
|           | `log [--subject <s>] [--limit <n>]`                     | Lists the operation log, newest first. The default limit is 50. |
|           | `query "<sql>"`                                         | Runs one SQL statement on a read-only connection.               |
| Target    | `target open <targetId>`                                | Records a setup request.                                        |
|           | `target request <targetId>`                             | Prints the setup request.                                       |
|           | `target save <targetId>`                                | Saves a profile from standard input.                            |
|           | `target show <targetId[@rev]>`                          | Prints a profile.                                               |
| Plan      | `plan open <planId> --target <targetId@rev>`            | Records a plan request.                                         |
|           | `plan request <planId>`                                 | Prints the request with the resolved tools.                     |
|           | `plan save <planId>`                                    | Saves revision 1 from a candidate.                              |
|           | `plan show <planId[@rev]>`                              | Prints a revision. Without `@rev`, the latest.                  |
|           | `plan list`                                             | Lists each plan at its latest revision.                         |
|           | `plan pending <planId>`                                 | Prints the pending decisions and the tests they affect.         |
|           | `plan revise <planId>`                                  | Saves the next revision from a delta.                           |
|           | `plan diff <planId> <from> <to>`                        | Prints the field changes and a JSON Patch.                      |
| Decisions | `gap answer <planId> <gapId>`                           | Records an answer to a gap.                                     |
|           | `plan edit <planId@rev> [--patch]`                      | Changes the latest revision.                                    |
|           | `plan adopt-gaps <planId@rev> --run <runId>`            | Adds the gaps of a run to the plan.                             |
|           | `plan approve <planId@rev>`, `plan reject <planId@rev>` | Records a verdict on a revision.                                |
|           | `result accept <runId>`, `result reject <runId>`        | Records a verdict on a result.                                  |
| Run       | `run gate <planId@rev>`                                 | Checks the gate. Records nothing.                               |
|           | `run begin <runId> <planId@rev>`                        | Checks the gate and starts a run.                               |
|           | `run check <runId> <testId> <assertionId>`              | Records one assertion result with evidence.                     |
|           | `run close <runId> <testId>`                            | Closes a test and derives its outcome.                          |
|           | `run finding <runId>`, `run gap <runId>`                | Records a finding or a new gap from standard input.             |
|           | `run finish <runId>`                                    | Checks the run and stores the result.                           |
|           | `run resume <runId>`                                    | Records a new attempt for a stalled run.                        |
|           | `run show <runId>`, `run list`                          | Prints a run, or lists runs.                                    |
| Output    | `export plan <ref>`, `export run <runId>`               | Prints a report as `md`, `html`, or `json`.                     |
|           | `evidence get <evidenceId> --out <file>`                | Writes the evidence bytes to a new file.                        |
|           | `ui`                                                    | Starts the review UI.                                           |
| npm only  | `delegate <stage> <subject>`                            | Runs a stage in a new Claude Code session.                      |

The run commands are in [Runs and evidence](runs.md). The payloads are in [Payloads](payloads.md).

## Read the state

| Question                                 | Command                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| What waits for the oracle?               | `checkmate inbox`                                    |
| Where is a plan in the loop? Who acts?   | `checkmate status <planId>`                          |
| Which plans exist, and what blocks them? | `checkmate plan list`                                |
| What is in a plan revision?              | `checkmate plan show <planId@rev>`                   |
| Which runs exist?                        | `checkmate run list [--plan <planId>] [--build <b>]` |
| What did a run record?                   | `checkmate run show <runId> [--tests T1,T2]`         |
| What changed, and who changed it?        | `checkmate log [--subject <subject>]`                |
| Anything else                            | `checkmate query "<sql>"`                            |

- **inbox.** The first field of a line is `<planId@rev>/<gapId>`, `<planId@rev>`, `<runId>`, or `<planId>`. The second field is `gap`, `run_gap`, `plan`, `result`, or `requested`. A `run_gap` line is a gap of a run that the plan does not have yet. Its fourth field is the run ID. A `result` line shows only the latest run of a retest chain.
- **plan list.** Prints `gaps=`, `approval=`, `blocked=`, `state=`, and `waitsOn=` for each plan. `gaps=` lists the open blocking gaps, also of runs. A request without a revision prints `status=requested`. Filters: `--needs-decision`, `--awaiting-approval`, `--blocked`, and `--waits-on <planner|oracle|qa|factory|none>`.
- **plan show.** Takes `--tests T1,T2`, `--fields <fields>`, and `--gaps open|all`.
- **log.** A subject is `target:<targetId>`, `plan:<planId>`, `run:<runId>`, or `inbox`.

## Loop states

`checkmate status <planId>` derives the loop state from the records. Checkmate stores no loop state. Line 1 has `state=` and `waitsOn=`. Then come `why` lines, a `next` line, the open gaps, the pending decisions, and the defects of the latest finished run.

```text
completed checkout state=needs_revision waitsOn=planner revision=2 approval=pending run=run-1
why	G1 has a pending clarify decision
next	checkmate delegate revise checkout
01M7CVYCKGM0TNPWADTFZGRZ0J	pending	G1	clarify
```

| State               | Waits on | Meaning                                                                                        |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `needs_plan`        | planner  | The plan request has no revision.                                                              |
| `run_in_progress`   | qa       | A run of the plan is started.                                                                  |
| `needs_revision`    | planner  | A gap answer waits for the revise stage.                                                       |
| `plan_rejected`     | oracle   | The latest revision is rejected. Change the plan.                                              |
| `needs_answers`     | oracle   | A gap or a run gap is open without an answer.                                                  |
| `needs_approval`    | oracle   | The latest revision waits for approval.                                                        |
| `ready_to_run`      | qa       | The latest revision is approved or needs no approval, no run is finished, and a test is ready. |
| `nothing_to_run`    | oracle   | No test is ready and no gap is open.                                                           |
| `defects_open`      | factory  | The latest finished run has defects. Build a fix, then retest.                                 |
| `needs_retest`      | qa       | The latest run did not pass every test, tested an older revision, or is rejected.              |
| `awaits_acceptance` | oracle   | The latest run passed every selected test. Its result waits for acceptance.                    |
| `accepted`          | none     | The oracle accepted the result.                                                                |
| `passed`            | none     | The latest run passed. Result acceptance is not required.                                      |

Checkmate checks the states in this order and prints the first one that applies. After a finished run, an open blocking gap gives `needs_answers` first, then open defects give `defects_open`, then an open non-blocking gap gives `needs_answers`. A run that a later run retests does not count. An approved revision with open gaps is `ready_to_run` until its first run finishes.

## Input

- Lists in flags are comma-separated, for example `--tests T1,T2`.
- A payload is JSON on standard input. Redirect a file, or use a quoted heredoc. A skill or a worker always uses a heredoc and writes no payload file.

  ```sh
  checkmate run finding run-1 <<'EOF'
  { "id": "F1", "type": "defect", ... }
  EOF
  ```

- `run check` and `run close` take `--evidence -` for text on standard input. Read [Evidence input](runs.md#evidence-input).
- `target open` takes `--tool <name>:<cli|mcp|skill>:<purpose>` once for each tool.
- `plan open` takes `--objective`, `--source` (repeatable), and `--instructions` in place of JSON.
- A decision command takes `--expect-sha <digest>`. It stops when the snapshot has another digest.

## Output

- Line 1 is `<status> <subject>` with short `key=value` facts.
- Each item is one line, ID first, with tab-separated fields.
- `reason:` lines follow.
- `--json` prints `{ "status", "subject", "reasons", ... }`.
- `export` prints the report. With `--out <path>`, it writes a new file and prints the response. It refuses an existing file.

## Statuses and exit codes

| Status              | Meaning                                                                                  | Exit |
| ------------------- | ---------------------------------------------------------------------------------------- | ---- |
| `completed`         | The command did its work.                                                                | 0    |
| `needs_decision`    | The oracle must decide or give input. Read the `reason:` lines. A write can be recorded. | 0    |
| `rejected`          | Checkmate refused the command. Nothing changed. Correct the input and try again.         | 1    |
| `invalid_request`   | The command name or the options are wrong.                                               | 1    |
| `interrupted`       | A run or a delegated worker stopped at the deadline or on a signal.                      | 1    |
| `operational_error` | A tool, access, or worker failure stopped the work.                                      | 1    |

`needs_decision` exits with 0. For example, `plan save` with open gaps saves the revision and gives `needs_decision`. `run begin` gives `needs_decision` when the gate refuses the run, and then no run exists. Read line 1, not only the exit code.

## Run gate and policy

`run gate` and `run begin` check the gate. They collect every reason and do not stop at the first one:

1. The target profile is ready for live execution.
2. When plan approval is required, the exact revision is approved.
3. With `--partial wait_for_resolution`, no blocking gap is open.
4. Each selected test exists, is ready, uses a capability and allowed operations of the target, has assertions, and has its local prerequisites in the selection.
5. Each cross-plan dependency has a finished `passed` result for the same build, accepted when required, and no open blocking gap applies to it.
6. A retest names a finished run of the same plan and target, with another build.

`run begin` takes these flags. `run gate` takes the same flags except `--on-new-blocker` and `--timeout`.

| Flag               | Values                                      | Default                                       |
| ------------------ | ------------------------------------------- | --------------------------------------------- |
| `--tests`          | A list of test IDs.                         | Required, except with `--partial ready_only`. |
| `--build`          | The application build identity.             | Required.                                     |
| `--partial`        | `wait_for_resolution`, `ready_only`         | `wait_for_resolution`                         |
| `--on-new-blocker` | `return_to_oracle`, `continue_independent`  | `return_to_oracle`                            |
| `--timeout`        | 1 to 3600 seconds.                          | 600                                           |
| `--retest-of`      | A finished run of the same plan and target. | None.                                         |

- `ready_only` permits a selection of ready tests. Without `--tests`, Checkmate selects the ready tests and prints `<testId> left_out <reason>` for each other test. When no test is ready, the gate refuses the run.
- `--on-new-blocker` tells QA what to do after it records a new blocking gap. `return_to_oracle` stops and closes the remaining tests as `blocked`. `continue_independent` continues the tests that the gap does not affect. Checkmate records the policy. The agent applies it.
- A retest needs a new run ID and a new build.

## delegate

```sh
checkmate delegate <setup|plan|revise|execute> <subject> --allow <rule>... [--timeout <seconds>] [--workspace <path>] [--json]
```

| Stage     | Subject    | Before the call                         | The parent checks after the call                       |
| --------- | ---------- | --------------------------------------- | ------------------------------------------------------ |
| `setup`   | `targetId` | `target open`                           | The worker saved a profile.                            |
| `plan`    | `planId`   | `plan open`, with no revision           | Revision 1 exists.                                     |
| `revise`  | `planId`   | One or more decisions from `gap answer` | A new revision exists and no pending decision remains. |
| `execute` | `runId`    | `run begin`                             | The run is finished.                                   |

`delegate` starts one new `claude -p` session with the bundled plugin, a response schema, `--permission-prompts none`, and `--no-session-persistence`. It sets `CHECKMATE_ACTOR=claude:<stage>` for the worker.

**Trust.** The parent does not trust the worker's summary. It reads the database and returns the response of the recorded command, with `operation=<id>` on line 1. A worker that reports `completed` without the change gives `operational_error`. In setup, plan, and revise, a worker that reports `needs_decision` without a change gives `needs_decision` with the worker's reasons, for example a source that it cannot read.

**Permissions.** Give one `--allow <rule>` for each Claude tool permission. `delegate` refuses an empty list. Give at least `Read` and `Bash`. A prefix rule such as `Bash(node *)` is not sufficient, because the permission check blocks a heredoc with JSON. `Bash` lets the worker run any shell command in the workspace, so use a trusted workspace. Add rules for the tools of the target or the plan: `mcp__jira` allows every tool of the `jira` server, and `mcp__jira__get_issue` allows one tool. An execute stage that saves screenshots with another tool can need `Write`. The launcher adds no permission bypass.

**Deadlines.** `--timeout` sets the deadline in seconds. Setup, plan, and revise use 300 seconds by default. Execute uses the deadline that `run begin` recorded. The launcher stops the worker's process group at the deadline, on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

**After execute.** The parent closes the run's browser session with `playwright-cli -s=<browserSession> close`. When the worker stops before `run finish`, the run stays `started` and its results stay. The response is `interrupted` or `operational_error`, and its reason names `run resume` and `run finish`.

**Platforms.** Linux is tested. The launcher refuses Windows.

## ui

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

Prints `completed ui url=<url>` and serves the review UI on `127.0.0.1` until SIGINT or SIGTERM. The default port is a free port. The UI writes only when a human submits a form. Read [Review in the browser](../guides/review-ui.md).

## Environment variables

| Variable                    | Read by        | Effect                                                                                   |
| --------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `CHECKMATE_ACTOR`           | Checkmate      | The default actor of a write. `--actor` overrides it.                                    |
| `ANTHROPIC_MODEL`           | The host       | Claude Code selects the model with it. Checkmate does not read it. `delegate` passes it. |
| `PLAYWRIGHT_MCP_OUTPUT_DIR` | Playwright CLI | `delegate execute` sets it to `.checkmate/tmp/<runId>`, so browser output stays there.   |

The tests read more variables. Read [Development](../development.md).

## Next

- [Payloads](payloads.md): the JSON for each command.
- [Runs and evidence](runs.md): the run commands in detail.
