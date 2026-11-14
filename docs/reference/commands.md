# Commands

> **Reference** · Every command, its input and output, the statuses, the loop states, `delegate`, and `ui`.

Checkmate has one command set with two command lines. Small values go in flags, structured payloads go in JSON on standard input, and line 1 of every response is the status.

**On this page:** [Two command lines](#two-command-lines) · [Command list](#command-list) · [Read the state](#read-the-state) · [Loop states](#loop-states) · [Input](#input) · [Output](#output) · [Statuses and exit codes](#statuses-and-exit-codes) · [Run gate and policy](#run-gate-and-policy) · [delegate](#delegate) · [ui](#ui) · [Environment variables](#environment-variables)

## Two command lines

| Command line | Command                                  | Has                             |
| ------------ | ---------------------------------------- | ------------------------------- |
| Plugin       | `node "<plugin root>/dist/checkmate.js"` | Every command except `delegate` |
| npm CLI      | `checkmate` from `@xoxoai/checkmate`     | Every command and `delegate`    |

The skills run the plugin CLI with its absolute path. Claude Code gives the path to a skill when it loads the skill. The plugin has no npm dependencies and no global `checkmate` command.

Every command takes `--workspace <path>` and `--json`. Put options after the command name, for example `checkmate plan list --workspace ../app`. The workspace is the current directory by default. A write takes `--actor <name>`.

`checkmate --help` prints every command with its options. `checkmate <command> --help` prints the usage of that command with `completed` on line 1. For a group, for example `checkmate plan --help`, it prints each command of the group. `checkmate --version` prints the npm CLI version.

## Command list

| Group     | Command                                                 | Does                                                                                                                              |
| --------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| State     | `init`                                                  | Creates `.checkmate/checkmate.db`. Any command does this too.                                                                     |
|           | `inbox`                                                 | Lists what waits for the oracle.                                                                                                  |
|           | `status <planId>`                                       | Prints the loop state of one plan.                                                                                                |
|           | `log [--subject <s>] [--limit <n>] [--after <rowid>]`   | Lists the operation log, newest first. The limit is 1 to 1000. The default is 50.                                                 |
|           | `query "<sql>"`                                         | Runs one SQL statement on a read-only connection. It refuses a second statement, a write, and a statement without result columns. |
| Target    | `target open <targetId>`                                | Records a setup request.                                                                                                          |
|           | `target request <targetId>`                             | Prints the setup request.                                                                                                         |
|           | `target save <targetId>`                                | Saves a profile from standard input.                                                                                              |
|           | `target list`                                           | Lists each target with its latest revision and instances.                                                                         |
|           | `target show <targetId[@rev]> [--instance <id>]`        | Prints a profile, and the values of one instance.                                                                                 |
|           | `target instance add <targetId> <instanceId>`           | Adds an instance from `--entry` flags or standard input.                                                                          |
|           | `target instance retire <targetId> <instanceId>`        | Retires an instance. No new run can start on it.                                                                                  |
|           | `target instance list <targetId>`                       | Lists the instances of a target, active and retired.                                                                              |
| Plan      | `plan open <planId> --target <targetId@rev>`            | Records a plan request.                                                                                                           |
|           | `plan request <planId>`                                 | Prints the request with the resolved tools.                                                                                       |
|           | `plan save <planId>`                                    | Saves revision 1 from a candidate.                                                                                                |
|           | `plan show <planId[@rev]>`                              | Prints a revision. Without `@rev`, the latest.                                                                                    |
|           | `plan list`                                             | Lists each plan at its latest revision.                                                                                           |
|           | `plan pending <planId>`                                 | Prints the pending decisions and the tests they affect.                                                                           |
|           | `plan revise <planId>`                                  | Saves the next revision from a delta.                                                                                             |
|           | `plan diff <planId> <from> <to>`                        | Prints the field changes and a JSON Patch.                                                                                        |
| Decisions | `gap answer <planId> <gapId>`                           | Records an answer to a gap.                                                                                                       |
|           | `plan edit <planId@rev> [--patch]`                      | Changes the latest revision.                                                                                                      |
|           | `plan adopt-gaps <planId@rev> --run <runId>`            | Adds the gaps of a run to the plan.                                                                                               |
|           | `plan approve <planId@rev>`, `plan reject <planId@rev>` | Records a verdict on the latest revision.                                                                                         |
|           | `result accept <runId>`, `result reject <runId>`        | Records a verdict on a result.                                                                                                    |
| Run       | `run gate <planId@rev>`                                 | Checks the gate. Records nothing.                                                                                                 |
|           | `run begin <runId> <planId@rev>`                        | Checks the gate and starts a run on one instance.                                                                                 |
|           | `run check <runId> <testId> <assertionId>`              | Records one assertion result with evidence.                                                                                       |
|           | `run close <runId> <testId>`                            | Closes a test and derives its outcome.                                                                                            |
|           | `run finding <runId>`, `run gap <runId>`                | Records a finding or a new gap from standard input.                                                                               |
|           | `run finish <runId>`                                    | Checks the run and stores the result.                                                                                             |
|           | `run resume <runId>`                                    | Records a new attempt for a stalled run.                                                                                          |
|           | `run show <runId>`, `run list`                          | Prints a run, or lists runs.                                                                                                      |
|           | `finding list [--plan <planId>] [--open]`               | Lists the findings of all runs, one line for each finding.                                                                        |
| Output    | `export plan <ref>`, `export run <runId>`               | Prints a report as `md`, `html`, `json`, or `junit` (run only).                                                                   |
|           | `evidence get <evidenceId> --out <file>`                | Writes the evidence bytes to a new file.                                                                                          |
|           | `ui`                                                    | Starts the review UI.                                                                                                             |
| npm only  | `delegate <stage> <subject>`                            | Runs a stage in a new Claude Code session.                                                                                        |

The run commands are in [Runs and evidence](runs.md). The payloads are in [Payloads](payloads.md).

## Read the state

| Question                                 | Command                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| What waits for the oracle?               | `checkmate inbox`                                    |
| Which targets exist? Where do they run?  | `checkmate target list`                              |
| Where is a plan in the loop? Who acts?   | `checkmate status <planId>`                          |
| Which plans exist, and what blocks them? | `checkmate plan list`                                |
| What is in a plan revision?              | `checkmate plan show <planId@rev>`                   |
| Which runs exist?                        | `checkmate run list [--plan <planId>] [--build <b>]` |
| What did a run record?                   | `checkmate run show <runId> [--tests T1,T2]`         |
| Which defects are open?                  | `checkmate finding list --open [--plan <planId>]`    |
| What changed, and who changed it?        | `checkmate log [--subject <subject>]`                |
| Anything else                            | `checkmate query "<sql>"`                            |

- **inbox.** The first field of a line is `<planId@rev>/<gapId>`, `<planId@rev>`, `<runId>`, or `<planId>`. The second field is `gap`, `run_gap`, `plan`, `result`, or `requested`. A `run_gap` line is a gap of a run that the plan does not have yet. Its fourth field is the run ID. A `plan` line is a latest revision that waits for approval, or a rejected latest revision. The summary of a rejected revision starts with `Rejected. Change the plan.`, and `--json` gives `approval` as `pending` or `rejected`. A `result` line is a finished run without a decision, when result acceptance is required. The inbox lists every run that needs an oracle verdict before the plan can finish: each run that has the latest outcome of a ready test, and each run with an open defect of a ready test. It lists them also while `status` waits on `qa` or `factory`, because the oracle can accept a result, or reject a false defect, at any time.
- **plan list.** Prints `gaps=`, `approval=`, `blocked=`, `state=`, and `waitsOn=` for each plan. `gaps=` lists the open blocking gaps, also of runs. A request without a revision prints `status=requested`. Filters: `--needs-decision`, `--awaiting-approval`, `--blocked`, and `--waits-on <planner|oracle|qa|factory|none>`.
- **plan show.** Takes `--tests T1,T2`, `--fields <fields>`, and `--gaps open|all`. A decision line gives the decision ID, the gap, the kind, the value, and the rationale. When the revision has an approval decision, the last line is `decision`, the verdict, the actor, the time, and the rationale.
- **plan pending.** Prints one line for each pending decision: the decision ID, the gap, the kind, the value, and the rationale. Then it prints the affected gaps and tests.
- **target show.** Prints one `entryPoint` line for each entry point, the `authentication` kind and references, the tools, and one `instance` line for each active instance. With `--instance <instanceId>`, it also prints `entry`, `environment`, and `reference` lines with the values of that instance.
- **target instance list.** Prints one line for each instance: the instance ID, `active` or `retired`, the environment, and the entry values as `<entryPoint>=<value>`. The entries are separated by `,`. A value that contains a space, `,`, `=`, `"`, or `\` is a JSON string, for example `web="https://shop.example.com/?a=b"`. That JSON string is the only escaping layer: `C:\app "x"` prints as `web="C:\\app \"x\""`. Read it with a JSON parser.
- **target instance retire.** When started runs use the instance, it prints a `warning` line that names them.
- **run show.** Line 1 has `acceptance=`. When the result has a decision, the last line is `decision`, the verdict, the actor, the time, and the rationale.

  ```text
  decision	rejected	Dawid	2026-11-14T21:04:53.915Z	I need fullsize screenshots for evidence
  ```

- **run list.** Prints the run, the plan revision, the build, the instance, the state, the completion, the coverage, and the acceptance.
- **finding list.** Prints one line for each finding of each run, oldest first: `<runId>/<findingId>`, the plan revision, the build, the instance, the type, the severity, the tests, the metadata as `key=value` pairs separated by `; `, and the title. `--plan <planId>` keeps the findings of one plan. `--open` keeps the [open defects](runs.md#open-defects), also of deferred or removed tests. `status` prints only the open defects of ready tests. For the complete metadata and the other fields, use `--json`. `--json` gives `findings`, and each row has `runId`, `planId`, `revision`, `build`, `instanceId`, `testIds`, `findingId`, `type`, `severity`, `title`, `expected`, `observed`, `reproduction`, `requirementIds`, `assertionIds`, `evidenceIds`, and `metadata`.

  ```text
  completed findings count=1
  run-1/F1	checkout@2	build-1	local	defect	high	T2	component=pricing; jiraKey=SHOP-142	Promotion stacks with loyalty
  ```

- **log.** A subject is `target:<targetId>`, `plan:<planId>`, `run:<runId>`, or `inbox`. The last field of each line is the row ID of the operation. `--json` gives it as `rowid`. A decision with a rationale (`gap answer`, `plan approve`, `plan reject`, `result accept`, `result reject`) has the rationale before the row ID. `--after <rowid>` lists only the operations after that row ID, oldest first. To read the next page, give the last row ID that you read.

## Loop states

`checkmate status <planId>` derives the loop state from the records. Checkmate stores no loop state. Line 1 has `state=` and `waitsOn=`, and `run=` names the latest run in begin order. Then come `why` lines, `next` lines, one `started` line for each open run, the open gaps, the pending decisions, and the [open defects](runs.md#open-defects) of the ready tests. A `started` line names the run, the build, and the instance. A matrix of five runs on five instances prints five `started` lines.

```text
completed checkout state=needs_revision waitsOn=planner revision=2 approval=pending run=run-1
why	G1 has a pending clarify decision
next	checkmate delegate revise checkout --allow Read --allow Bash
01M7CVYCKGM0TNPWADTFZGRZ0J	pending	G1	clarify
```

| State               | Waits on | Meaning                                                                                                                                                               |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needs_plan`        | planner  | The plan request has no revision.                                                                                                                                     |
| `run_in_progress`   | qa       | One or more runs of the plan are started.                                                                                                                             |
| `needs_revision`    | planner  | A gap answer waits for the revise stage.                                                                                                                              |
| `plan_rejected`     | oracle   | The latest revision is rejected. Change the plan. The `why` line gives the actor and the rationale.                                                                   |
| `needs_answers`     | oracle   | A gap or a run gap is open without an answer.                                                                                                                         |
| `needs_approval`    | oracle   | The latest revision waits for approval.                                                                                                                               |
| `ready_to_run`      | qa       | The latest revision is approved or needs no approval, no run is finished, and the gate can select a test.                                                             |
| `nothing_to_run`    | oracle   | No test is ready, or the gate cannot select a test that needs a run. The `why` lines name the blockers.                                                               |
| `nothing_to_run`    | qa       | As above, and a cross-plan dependency blocks a test. The `next` line names `checkmate status` of the other plan.                                                      |
| `defects_open`      | factory  | A ready test has an open defect. Build a fix, then retest.                                                                                                            |
| `needs_retest`      | qa       | A ready test has not run on the latest revision, a latest outcome is not `passed`, or a latest pass is in a rejected run. Or a run that status uses did not complete. |
| `awaits_acceptance` | oracle   | Each ready test passed in its latest run. One or more of these runs wait for acceptance. The `why` lines name them.                                                   |
| `accepted`          | none     | The oracle accepted each run that has the latest outcome of a ready test.                                                                                             |
| `passed`            | none     | Each ready test passed in its latest run. Result acceptance is not required.                                                                                          |

When the oracle rejected the latest revision, or a run that has a latest outcome of a ready test, a `why` line gives the decision: `<subject> was rejected by <actor>: <rationale>`. Address the rationale in the next revision or the next run.

A `next` line is a hint for a person or an agent. Do not parse it. Replace each `<placeholder>` with a value, and the command runs. The gate does not refuse a `run begin` hint. A state can give more than one `next` line: one `delegate execute` for each started run, one retest for each run with open defects, one rerun for each run that gives a `needs_retest` reason, and one `result accept` for each run that waits. `--json` gives `next` as a list. A `delegate` hint has the minimum rules `--allow Read --allow Bash`. When the target has two or more active instances, a `run begin` hint has `--instance`: the instance of the earlier run when it is still active, else `<instanceId>`. A rerun uses the build and the instance of the run that needs it. When that instance is retired, the rerun is a retest on a new instance with `--retest-of` and the same build. When a test has a cross-plan dependency, a `run begin` hint names the build on which the dependencies select the most tests, and the newest build on a tie.

`--json` also gives `stage`: the `delegate` stage that the plan waits on. It is `plan` for `needs_plan`, `revise` for `needs_revision`, `execute` for `run_in_progress`, and `none` for every other state. The subject of `plan` and `revise` is the plan ID. The subjects of `execute` are the run IDs in `openRuns`, one for each started run. `latestRun` is the latest run in begin order.

`status` tries the states in this order and prints the first one that applies. Before the first finished run, only an open blocking gap gives `needs_answers`. After a finished run, an open blocking gap gives `needs_answers` first, then open defects give `defects_open`, then an open non-blocking gap gives `needs_answers`. `status` looks only at the tests of the latest revision that are `ready`. A ready test whose local prerequisite is deferred, directly or through a chain of prerequisites, counts as deferred. A `why` line names it, for example `T2 deferred: prerequisite T1 is deferred`, and `run gate --partial ready_only` leaves it out with that reason. When no test is ready, the plan has verified nothing, also after a finished run. Then the state is `nothing_to_run`. It waits on the oracle to change the plan or to answer the deferred gaps, and the `why` lines name each deferral. `accepted` and `passed` need one or more ready tests. A deferred test or a removed test does not keep the plan in `defects_open` or `needs_retest`. A started run changes no outcome and closes no defect. Before the first finished run, a plan is `ready_to_run` when the gate can select a test with `--partial ready_only`. After it, a ready test that has not run gives `needs_retest`. An approved revision with open gaps is `ready_to_run` until its first run finishes. The `why` lines name each run in begin order.

**Latest outcomes.** Checkmate orders runs by the time that they began, not by the time that they finished. An outcome counts for the latest revision only when the run's revision has the same definition of the test: the same `action`, `preconditions`, `assertions`, `dependsOn`, `capability`, `operations`, and `requirementIds`, and the same text of each of these requirements. Thus a changed requirement text, or a new requirement of a test, needs a retest. Else the test has not run on the latest revision. A new revision that changes only other fields, for example a title, keeps every outcome. It needs no rerun. A later run replaces the outcome of an earlier run for a test only when it is on the same instance, on a different build, or a retest in the chain of the earlier run. Thus a build can have one latest outcome for each instance. Each one must be `passed`. On the same build, a pass on one instance does not hide a failure on another instance.

**Nothing to run.** When `needs_retest` or `ready_to_run` would apply, `status` uses the selection of `run gate --partial ready_only`. Checkmate tries the build of each run that needs a rerun, then each build on which a cross-plan dependency passed, newest first. When the gate cannot select a test that needs a run on any of these builds, the state is `nothing_to_run`. The `why` lines give the reason for each test that the gate leaves out, for example a deferred prerequisite. For a cross-plan dependency that has not passed, `status` waits on `qa`, and the `next` line is `checkmate status <otherPlanId>`. Else it waits on `oracle`, and the `next` line is `plan edit --patch`.

## Input

- Lists in flags are comma-separated, for example `--tests T1,T2`.
- A payload is JSON on standard input. Redirect a file, or use a quoted heredoc. A skill or a worker always uses a heredoc and writes no payload file.

  ```sh
  checkmate run finding run-1 <<'EOF'
  { "id": "F1", "type": "defect", ... }
  EOF
  ```

- `run check` and `run close` take `--evidence -` for text on standard input. Read [Evidence input](runs.md#evidence-input).
- `target open` takes `--entry-point <name>:<url|command|value>:<purpose>` once for each entry point. It needs one or more. The name uses letters, digits, `_`, and `-`. The purpose can contain `:`.
- `target open` takes `--tool <name>:<cli|mcp|skill>:<purpose>` once for each tool. The name uses letters, digits, `_`, and `-`, as an entry point name does, with an optional `<plugin>:` prefix, for example `checkmate:ui`. A tool object in a plan request has the same rule.
- `target instance add` takes `--entry <entryPoint>=<value>` once for each entry point, `--environment <text>`, and `--reference <text>` (repeatable). Without `--entry`, it reads the instance JSON on standard input. Read [Payloads](payloads.md#instance).
- `plan open` takes `--objective`, `--source` (repeatable), and `--instructions` in place of JSON.
- A decision command takes `--expect-sha <digest>`. It stops when the snapshot has another digest.

## Output

- Line 1 is `<status> <subject>` with short `key=value` facts.
- Each item is one line, ID first, with tab-separated fields.
- `reason:` lines follow.
- `--json` prints `{ "status", "subject", "reasons", ... }`.
- `export` prints the report. With `--out <path>`, it writes a new file and prints the response. It refuses an existing file.
- A schema error names the field. An unknown field gives `<payload>/<path> has unknown field "<name>"`. A wrong value of a fixed list gives `<payload>/<path> must be one of: <values>`. A value of the wrong type gives `<payload>/<path> must be <type>`. When a field takes more than one type, for example a string or an object, the error names only the type of the value that you sent. When no type agrees, it lists all types, for example `must be string, number, or boolean`. Read [Payloads](payloads.md#schemas).
- An option value that is not in its fixed list or not in its range gives `invalid_request`, for example `log --limit 0`, `log --subject bogus`, or `export run run-1 --format pdf`. The usage line shows a fixed list as `<a|b>`. The command does not start, and the log has no row.

## Statuses and exit codes

| Status              | Meaning                                                                                  | Exit |
| ------------------- | ---------------------------------------------------------------------------------------- | ---- |
| `completed`         | The command did its work.                                                                | 0    |
| `needs_decision`    | The oracle must decide or give input. Read the `reason:` lines. A write can be recorded. | 0    |
| `rejected`          | Checkmate refused the command. Nothing changed. Correct the input and try again.         | 1    |
| `invalid_request`   | The command name or the options are wrong.                                               | 1    |
| `interrupted`       | A run or a delegated worker stopped at the deadline or on a signal.                      | 1    |
| `operational_error` | A tool, access, lock, or worker failure stopped the work.                                | 1    |

**Lock.** One command writes at a time. Every command waits up to 30 seconds for the database lock, also a read such as `log`, `status`, or `inbox`. Set `CHECKMATE_BUSY_TIMEOUT_MS` to change the wait. When it cannot get the lock, it gives `operational_error` with the reason `Another command holds the database lock. Nothing changed. Run the command again.` Run the same command again. The log has no row for that attempt.

`needs_decision` exits with 0. For example, `plan save` with open gaps saves the revision and gives `needs_decision`. `run begin` gives `needs_decision` when the gate refuses the run, and then no run exists. Read line 1, not only the exit code.

## Run gate and policy

`run gate` and `run begin` refuse a revision that is not the latest revision. Then they check the gate. They collect every reason and do not stop at the first one:

1. The target profile is ready for live execution.
2. When plan approval is required, the exact revision is approved.
3. With `--partial wait_for_resolution`, no blocking gap of the plan is open, and no open blocking gap of a run affects a selected test.
4. Each selected test exists, is ready, uses a capability and allowed operations of the target, has assertions, and has its local prerequisites in the selection.
5. Each cross-plan dependency has a finished `passed` result for the same build, accepted when required, and no open blocking gap applies to it. A pass on any instance counts, also when a run on another instance failed the test.
6. A retest names a finished run of the same plan and target, with another build. The instance can be different. A retest can keep the build only when it runs on another instance and the instance of the earlier run is retired: the refreshed-sandbox case.

`run begin` checks the instance first. It refuses an unknown instance and a retired instance.

`run begin` takes these flags. `run gate` takes the same flags except `--instance`, `--on-new-blocker`, and `--timeout`.

| Flag               | Values                                      | Default                                       |
| ------------------ | ------------------------------------------- | --------------------------------------------- |
| `--tests`          | A list of test IDs.                         | Required, except with `--partial ready_only`. |
| `--build`          | The application build identity.             | Required.                                     |
| `--instance`       | An active instance of the target.           | The only active instance of the target.       |
| `--partial`        | `wait_for_resolution`, `ready_only`         | `wait_for_resolution`                         |
| `--on-new-blocker` | `return_to_oracle`, `continue_independent`  | `return_to_oracle`                            |
| `--timeout`        | 1 to 3600 seconds.                          | 600                                           |
| `--retest-of`      | A finished run of the same plan and target. | None.                                         |

- `ready_only` permits a selection of ready tests. Without `--tests`, Checkmate selects the ready tests and prints `<testId> left_out <reason>` for each other test. It leaves out a test that an open blocking gap of a run affects. When no test is ready, the gate refuses the run.
- `--on-new-blocker` tells QA what to do after it records a new blocking gap. `return_to_oracle` stops and closes the remaining tests as `blocked`. `continue_independent` continues the tests that the gap does not affect. Checkmate records the policy. The agent applies it.
- A retest needs a new run ID and a new build.
- Give `--instance` when the target has two or more active instances. `run begin` refuses the run without it. `run gate` does not take `--instance`.
- For a matrix, begin one run of the same plan revision for each instance, for example `run-uat` with `--instance uat` and `run-staging` with `--instance staging`.

## delegate

```sh
checkmate delegate <setup|plan|revise|execute> <subject> --allow <rule>... [--timeout <seconds>] [--claude-arg <arg>]... [--workspace <path>] [--json]
```

| Stage     | Subject    | Before the call                         | The parent checks after the call                       |
| --------- | ---------- | --------------------------------------- | ------------------------------------------------------ |
| `setup`   | `targetId` | `target open`                           | The worker saved a profile.                            |
| `plan`    | `planId`   | `plan open`, with no revision           | Revision 1 exists.                                     |
| `revise`  | `planId`   | One or more decisions from `gap answer` | A new revision exists and no pending decision remains. |
| `execute` | `runId`    | `run begin`                             | The run is finished.                                   |

`delegate` starts one new `claude -p` session with the bundled plugin, a response schema, `--permission-prompts none`, and `--no-session-persistence`. It sets `CHECKMATE_ACTOR=claude:<stage>` for the worker.

**Rejected results.** When the oracle rejected a run that has a latest outcome of a selected test, the execute prompt has the line `The oracle rejected <runId>: <rationale>. Address it.`

**Trust.** The parent does not trust the worker's summary. It reads the database and returns the response of the recorded command, with `operation=<id>` on line 1. A worker that reports `completed` without the change gives `operational_error`. In setup, plan, and revise, a worker that reports `needs_decision` without a change gives `needs_decision` with the worker's reasons, for example a source that it cannot read.

**Permissions.** Give one `--allow <rule>` for each Claude tool permission. `delegate` refuses an empty list. Give at least `Read` and `Bash`. A prefix rule such as `Bash(node *)` is not sufficient, because the permission check blocks a heredoc with JSON. `Bash` lets the worker run any shell command in the workspace, so use a trusted workspace. Add rules for the tools of the target or the plan: `mcp__jira` allows every tool of the `jira` server, and `mcp__jira__get_issue` allows one tool. An execute stage that saves screenshots with another tool can need `Write`. The launcher adds no permission bypass of its own.

**Claude options.** Give one `--claude-arg <arg>` for each argument to add to the `claude` command. `delegate` adds them in the given order directly after `-p`, before its own options. The `--allowedTools` rules come last. So a flag without its value, for example `--claude-arg --model` alone, takes `--plugin-dir` as its value, so Claude does not get the plugin and can refuse the command. It cannot take a tool rule. Put each `--claude-arg` after the subject. The value of `--claude-arg` is always the next argument, also when it starts with `--`, for example `--claude-arg --json`. One `--claude-arg` takes one argument only. So `--claude-arg --model --workspace X` adds only `--model`, and `delegate` reads `--workspace X` as its own option. Give the model name in a second `--claude-arg`. A `--claude-arg` without a next argument gives `invalid_request`. For example, `--claude-arg --model --claude-arg claude-haiku-5-5` adds `--model claude-haiku-5-5`, and `--claude-arg --add-dir=../specs` adds `--add-dir=../specs`. `delegate` refuses `-p`, `--print`, `--output-format`, `--input-format`, `--json-schema`, `--verbose`, and `--plugin-dir`, because the worker contract needs their values. It refuses `--allowedTools` and `--allowed-tools`. Use `--allow` for tools. Claude Code checks the other arguments.

**`--claude-arg` can change permissions.** For example, `--permission-mode`, `--settings`, and `--tools` change what the worker can do. The host owns that choice. Checkmate does not check these arguments for permissions, and it does not record them.

**Deadlines.** `--timeout` sets the deadline in seconds, from 1 to 3600. Another value gives `invalid_request`. Setup, plan, and revise use 300 seconds by default. Execute uses the deadline that `run begin` recorded. The launcher stops the worker's process group at the deadline, on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

**Lock.** When the parent cannot get the database lock before it starts the worker, `delegate` gives `operational_error` with the reason to run the command again. When it cannot get the lock after the worker, the worker can have written already. Then the reason tells you to read `checkmate status` or `checkmate log` before you run `delegate` again.

**After execute.** When the target profile has a `playwright-cli` tool, the parent closes the run's browser session with `playwright-cli -s=<browserSession> close`. For another target, it runs no close command. When the worker stops before `run finish`, the run stays `started` and its results stay. The response is `interrupted` or `operational_error`, and its reason names `run resume` and `run finish`.

**Platforms.** Linux is tested. The launcher refuses Windows.

## ui

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

Prints `completed ui url=<url>` and serves the review UI on `127.0.0.1` until SIGINT or SIGTERM. The default port is a free port. The UI writes only when a human submits a form. The Settings button in the top bar opens Settings, with the targets and their instances. Read [Review in the browser](../guides/review-ui.md).

## Environment variables

| Variable                    | Read by        | Effect                                                                                                                            |
| --------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CHECKMATE_ACTOR`           | Checkmate      | The default actor of a write. `--actor` overrides it.                                                                             |
| `CHECKMATE_BUSY_TIMEOUT_MS` | Checkmate      | The wait for the database lock in milliseconds. A value that is not a whole number from 1 to 2147483647 gives the default, 30000. |
| `ANTHROPIC_MODEL`           | The host       | Claude Code selects the model with it. Checkmate does not read it. `delegate` passes it.                                          |
| `PLAYWRIGHT_MCP_OUTPUT_DIR` | Playwright CLI | `delegate execute` sets it to `.checkmate/tmp/<runId>`, so browser output stays there.                                            |

The tests read more variables. Read [Development](../development.md).

## Next

- [Payloads](payloads.md): the JSON for each command.
- [Runs and evidence](runs.md): the run commands in detail.
