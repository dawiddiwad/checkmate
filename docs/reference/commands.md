# Commands

> **Reference** · Every command, its input and output, the statuses, the loop states, `delegate`, and `ui`.

Checkmate has one command set with two command lines. Small values go in flags, structured payloads go in JSON on standard input, and line 1 of every response is the status.

**On this page:** [Two command lines](#two-command-lines) · [Command list](#command-list) · [Read the state](#read-the-state) · [Loop states](#loop-states) · [Input](#input) · [Output](#output) · [Statuses and exit codes](#statuses-and-exit-codes) · [Run gate and policy](#run-gate-and-policy) · [Lite mode](#lite-mode) · [Journal mode](#journal-mode) · [delegate](#delegate) · [ui](#ui) · [Environment variables](#environment-variables)

## Two command lines

| Command line | Command                                  | Has                             |
| ------------ | ---------------------------------------- | ------------------------------- |
| Plugin       | `node "<plugin root>/dist/checkmate.js"` | Every command except `delegate` |
| npm CLI      | `checkmate` from `@xoxoai/checkmate`     | Every command and `delegate`    |

The skills run the plugin CLI with its absolute path. Claude Code gives the path to a skill when it loads the skill. The plugin has no npm dependencies and no global `checkmate` command.

Every command takes `--workspace <path>` and `--json`. Put options after the command name, for example `checkmate plan list --workspace ../app`. The workspace is the nearest directory with a `.checkmate` store, from the current directory up. When no directory has a store, the workspace is the current directory. A write takes `--actor <name>`.

`checkmate --help` prints every command with its options. `checkmate <command> --help` prints the usage of that command with `completed` on line 1. For a group, for example `checkmate plan --help`, it prints each command of the group. `checkmate --version` prints the npm CLI version.

## Command list

| Group     | Command                                                                | Does                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State     | `init`                                                                 | Creates `.checkmate/checkmate.db`. Any command does this too.                                                                                                                                             |
|           | `inbox`                                                                | Lists what waits for the oracle.                                                                                                                                                                          |
|           | `status <planId>`                                                      | Prints the loop state of one plan.                                                                                                                                                                        |
|           | `log [--subject <s>] [--limit <n>] [--after <rowid>]`                  | Lists the operation log, newest first. The limit is 1 to 1000. The default is 50.                                                                                                                         |
|           | `query "<sql>"`                                                        | Runs one SQL statement on a read-only connection. It refuses a second statement, a write, and a statement without result columns.                                                                         |
| Target    | `target open <targetId>`                                               | Records a setup request.                                                                                                                                                                                  |
|           | `target request <targetId>`                                            | Prints the setup request.                                                                                                                                                                                 |
|           | `target save <targetId>`                                               | Saves a profile from standard input.                                                                                                                                                                      |
|           | `target list`                                                          | Lists each target with its latest revision and instances.                                                                                                                                                 |
|           | `target show <targetId[@rev]> [--instance <id>]`                       | Prints a profile, and the values of one instance.                                                                                                                                                         |
|           | `target instance add <targetId> <instanceId>`                          | Adds an instance from `--entry` flags or standard input.                                                                                                                                                  |
|           | `target instance retire <targetId> <instanceId>`                       | Retires an instance. No new run can start on it.                                                                                                                                                          |
|           | `target instance list <targetId>`                                      | Lists the instances of a target, active and retired.                                                                                                                                                      |
| Plan      | `plan open <planId> --target <targetId@rev>`                           | Records a plan request.                                                                                                                                                                                   |
|           | `plan request <planId>`                                                | Prints the request with the resolved tools.                                                                                                                                                               |
|           | `plan save <planId>`                                                   | Saves revision 1 from a candidate.                                                                                                                                                                        |
|           | `plan show <planId[@rev]>`                                             | Prints a revision. Without `@rev`, the latest.                                                                                                                                                            |
|           | `plan list`                                                            | Lists each plan at its latest revision.                                                                                                                                                                   |
|           | `plan pending <planId>`                                                | Prints the pending decisions and the tests they affect.                                                                                                                                                   |
|           | `plan revise <planId>`                                                 | Saves the next revision from a delta.                                                                                                                                                                     |
|           | `plan diff <planId> <from> <to>`                                       | Prints the field changes and a JSON Patch.                                                                                                                                                                |
| Decisions | `gap answer <planId> <gapId>`                                          | Records an answer to a gap.                                                                                                                                                                               |
|           | `plan edit <planId@rev> [--patch]`                                     | Changes the latest revision.                                                                                                                                                                              |
|           | `plan adopt-gaps <planId@rev> --run <runId>`                           | Adds the gaps of a run to the plan.                                                                                                                                                                       |
|           | `plan approve <planId@rev>`, `plan reject <planId@rev>`                | Records a verdict on the latest revision.                                                                                                                                                                 |
|           | `result accept <runId>`, `result reject <runId>`                       | Records a verdict on a result.                                                                                                                                                                            |
| Run       | `run gate <planId@rev>`                                                | Checks the gate. Records nothing.                                                                                                                                                                         |
|           | `run begin <runId> <planId@rev>`                                       | Checks the gate and starts a run on one instance.                                                                                                                                                         |
|           | `run check <runId> <testId> <assertionId>`                             | Records one assertion result with evidence.                                                                                                                                                               |
|           | `run close <runId> <testId>`                                           | Closes a test and derives its outcome.                                                                                                                                                                    |
|           | `run finding <runId>`, `run gap <runId>`                               | Records a finding or a new gap from standard input.                                                                                                                                                       |
|           | `run finish <runId>`                                                   | Checks the run and stores the result.                                                                                                                                                                     |
|           | `run resume <runId>`                                                   | Records a new attempt for a stalled run.                                                                                                                                                                  |
|           | `run show <runId>`, `run list`                                         | Prints a run, or lists runs.                                                                                                                                                                              |
|           | `finding list [--plan <planId>] [--open]`                              | Lists the findings of all runs, one line for each finding.                                                                                                                                                |
| Lite      | `lite guide [<planId>]`                                                | Prints the payload fields of the next step with an example, the state, the repeat lines, and what the record needs.                                                                                       |
|           | `lite checklist <planId> --target <targetId@rev>`                      | Records a checklist and questions as revision 1 of a lite plan.                                                                                                                                           |
|           | `lite show <planId>`                                                   | Prints the items, the repeat lines, the questions with their answers, the runs, the open defects, and the next steps.                                                                                     |
|           | `lite record <planId> --build <build> [--draft]`                       | Records one tested build as a new revision and a finished run, or saves a part with `--draft`. Read [Lite mode](#lite-mode).                                                                              |
| Journal   | `journal open <changeId> --target <targetId>`                          | Opens a change for the journal, with an optional `--instance`.                                                                                                                                            |
|           | `journal guide [<changeId>] [--role <role>]`                           | Prints how to log entries, from the entry schemas. With a change, it also prints the PM answers and the open defects. Read [Several testers](#several-testers) for `--role merger` and `--role verifier`. |
|           | `journal log <changeId> [--build <build>]`                             | Saves each valid entry of standard input, and refuses each invalid entry alone. Read [Journal mode](#journal-mode).                                                                                       |
|           | `journal gaps <changeId> [--build <build>] [--all]`                    | Prints the open items of a build: things the record does not show yet. `--all` prints all of them, for all actors.                                                                                        |
|           | `journal show <changeId> [--all]`, `journal export <changeId> [--all]` | Prints the record of a change, or exports it as JSON. `--all` shows the entries of all actors.                                                                                                            |
|           | `journal merge <changeId> --build <build>`                             | Prints the defects of all testers on a build, and the suggested groups. Read [Several testers](#several-testers).                                                                                         |
|           | `journal issues <changeId> [--build <build>]`                          | Prints the merged result: one line for each issue.                                                                                                                                                        |
|           | `journal verify <changeId> --build <build>`                            | Prints the issues that only one tester reported and that no other actor confirmed or refuted, with their steps.                                                                                           |
|           | `journal answer <changeId> <questionId> --answer <a>`                  | Records a PM answer.                                                                                                                                                                                      |
|           | `journal accept\|reject <changeId> --build <build>`                    | Records the decision of the oracle on a build, with `--rationale`, and prints the gaps of the build.                                                                                                      |
| Output    | `export plan <ref>`, `export run <runId>`                              | Prints a report as `md`, `html`, `json`, or `junit` (run only).                                                                                                                                           |
|           | `evidence get <evidenceId> --out <file>`                               | Writes the evidence bytes to a new file.                                                                                                                                                                  |
|           | `ui`                                                                   | Starts the review UI.                                                                                                                                                                                     |
| npm only  | `delegate <stage> <subject>`                                           | Runs a stage in a new Claude Code session.                                                                                                                                                                |

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
- **target show.** Prints one `entryPoint` line for each entry point, the `authentication` kind and references, the `startup` owner and commands, the `cleanup` text, the `reset` owner and commands when the profile has a reset, the tools, and one `instance` line for each active instance. With `--instance <instanceId>`, it also prints `entry`, `environment`, and `reference` lines with the values of that instance.
- **target instance list.** Prints one line for each instance: the instance ID, `active` or `retired`, the environment, and the entry values as `<entryPoint>=<value>`. The entries are separated by `,`. A value that contains a space, `,`, `=`, `"`, or `\` is a JSON string, for example `web="https://shop.example.com/?a=b"`. That JSON string is the only escaping layer: `C:\app "x"` prints as `web="C:\\app \"x\""`. Read it with a JSON parser.
- **target instance retire.** When started runs use the instance, it prints a `warning` line that names them.
- **run show.** Line 1 has `acceptance=`, and `cause=` for an interrupted run. A test line has `cause=deadline` when the test was closed with that cause. Line 2 is `time`, with the deadline in UTC and the elapsed and remaining seconds of the current attempt. Read [Deadline](runs.md#deadline). After the tests and the findings, a retest prints one `retest` line for each open defect of the earlier run, with the [verdict](runs.md#retest-verdicts). When the result has a decision, the last line is `decision`, the verdict, the actor, the time, and the rationale.

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

`checkmate status <planId>` derives the loop state from the records. Checkmate stores no loop state. Line 1 has `state=` and `waitsOn=`, and `run=` names the latest run in begin order. Then come `why` lines, `next` lines, one `started` line for each open run, the open gaps, the pending decisions, the [open defects](runs.md#open-defects) of the ready tests, and the [retest verdicts](runs.md#retest-verdicts) of the latest retest in begin order, while one of its defects is open or while it is the latest finished run. A `started` line names the run, the build, and the instance. A matrix of five runs on five instances prints five `started` lines.

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
- `plan open` takes `--objective`, `--source` (repeatable), and `--instructions` in place of JSON. Give the ticket and the existing product documentation as sources, for example `--source jira:SHOP-12 --source docs/checkout.md`. The planner plans regression tests from the existing rules in the documentation.
- A decision command takes `--expect-sha <digest>`. It stops when the snapshot has another digest.

## Output

- Line 1 is `<status> <subject>` with short `key=value` facts.
- Each item is one line, ID first, with tab-separated fields.
- `warning` lines follow. A warning does not stop the command. Read it and change the input when it applies.
- `reason:` lines follow.
- A `hint:` line follows when Checkmate can tell you what to do next. Read [Refusals](#refusals).
- `--json` prints `{ "status", "subject", "reasons", ... }`. A refusal adds `refusal` and can add `hint`. A warning is in `warnings`.
- `export` prints the report. With `--out <path>`, it writes a new file and prints the response. It refuses an existing file.
- A schema error names the field. A missing field gives `<payload>/<path> needs field "<name>"`. An unknown field gives `<payload>/<path> has unknown field "<name>"`. A wrong value of a fixed list gives `<payload>/<path> must be one of: <values>`. A value of the wrong type gives `<payload>/<path> must be <type>`. When a field takes more than one type, for example a string or an object, the error names only the type of the value that you sent. When no type agrees, it lists all types, for example `must be string, number, or boolean`. Read [Payloads](payloads.md#schemas).
- An option value that is not in its fixed list or not in its range gives `invalid_request`, for example `log --limit 0`, `log --subject bogus`, or `export run run-1 --format pdf`. The usage line shows a fixed list as `<a|b>`. The command does not start, and the log has no row.

## Refusals

When Checkmate refuses a command, the reply tells you why and how to correct it:

- Line 1 has `refusal=malformed` or `refusal=prohibited`. `--json` gives the same value in `refusal`.
- The first reason is `Refused: malformed request.` or `Refused: prohibited in the current state.`.
- The next reason says what is wrong.
- A `hint:` line, and `hint` in `--json`, tells you what to do. It names the missing field, the correct format, or the next command with the real IDs. Replace each `<placeholder>`.

| Refusal      | Meaning                                                                                                                                         | Do this                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `malformed`  | The command, an option, an argument, or the payload is wrong: an unknown command or option, a missing value, a wrong format, a schema error.    | Correct the command or the payload, as the hint says. Then send it again.      |
| `prohibited` | The command is well formed, but the record or a rule does not permit it now. For example, the run is not finished, or a defect is not recorded. | Do the step that the hint names first. Then send the command again, unchanged. |

Examples:

```text
rejected run-1 refusal=prohibited
reason: Refused: prohibited in the current state.
reason: Failed assertion T12.A3 needs a defect finding. Record it with run finding.
hint: Record the defect with checkmate run finding run-1. Send this JSON on standard input in a quoted heredoc, with your values: {"id":"F1","type":"defect",...,"assertionIds":["T12.A3"],...}. Then run run finish again. A recorded result is final: when you think it is wrong, still record the defect and say why in observed. The oracle can reject it.
```

```text
rejected checkout refusal=malformed
reason: Refused: malformed request.
reason: Ready test T14 needs one or more assertions
hint: Add an assertion to T14 in the delta: {"tests": {"T14": {"assertions": {"A1": {"check": "<expected result>", "checkKind": "deterministic"}}}}}. When no decision or source gives an expected value, use "checkKind": "agent_observation" with a check that records the behavior and checks only what the sources state.
```

```text
rejected run-b2 refusal=prohibited
reason: Refused: prohibited in the current state.
reason: Run run-b1 is not finished. Retest a finished run.
hint: Finish run-b1 first: checkmate run finish run-b1 --completion <completed|interrupted|operational_error> --cleanup <completed|failed|not_applicable> --cleanup-reason "<text>". Then run this command again. To start a run that is not a retest, leave out --retest-of.
```

`invalid_request` is always `malformed`. `rejected` is `malformed` or `prohibited`. When the gate refuses `run begin`, the status stays `needs_decision`, and the reply has `refusal=prohibited` and a hint. `run gate` gives the same hint without `refusal`, because it records nothing.

## Statuses and exit codes

| Status              | Meaning                                                                                  | Exit |
| ------------------- | ---------------------------------------------------------------------------------------- | ---- |
| `completed`         | The command did its work.                                                                | 0    |
| `needs_decision`    | The oracle must decide or give input. Read the `reason:` lines. A write can be recorded. | 0    |
| `rejected`          | Checkmate refused the command. Nothing changed. Read the hint, then try again.           | 1    |
| `invalid_request`   | The command name or the options are wrong. Read the hint for the usage.                  | 1    |
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
6. A retest selects each ready test with an open defect of the earlier run or of its retest chain, and each ready test with `"type": "regression"` in its metadata. The gate refuses a `--tests` selection without them, also with `--partial ready_only`. Without `--tests`, `--partial ready_only` selects them with the other ready tests. A test that is not ready is not required.
7. A retest names a finished run of the same plan and target, with another build. The instance can be different. A retest can keep the build only when it runs on another instance and the instance of the earlier run is retired: the refreshed-sandbox case.

`run begin` checks the instance first. It refuses an unknown instance and a retired instance.

`run begin` takes these flags. `run gate` takes the same flags except `--instance`, `--on-new-blocker`, and `--timeout`.

| Flag               | Values                                      | Default                                       |
| ------------------ | ------------------------------------------- | --------------------------------------------- |
| `--tests`          | A list of test IDs.                         | Required, except with `--partial ready_only`. |
| `--build`          | The application build identity.             | Required.                                     |
| `--instance`       | An active instance of the target.           | The only active instance of the target.       |
| `--partial`        | `wait_for_resolution`, `ready_only`         | `wait_for_resolution`                         |
| `--on-new-blocker` | `continue_independent`, `return_to_oracle`  | `continue_independent`                        |
| `--timeout`        | 1 to 3600 seconds. The run deadline.        | 600                                           |
| `--retest-of`      | A finished run of the same plan and target. | None.                                         |

- `ready_only` permits a selection of ready tests. Without `--tests`, Checkmate selects the ready tests and prints `<testId> left_out <reason>` for each other test. It leaves out a test that an open blocking gap of a run affects. When no test is ready, the gate refuses the run.
- `--on-new-blocker` tells QA what to do after it records a new blocking gap. `continue_independent` is the default. QA closes the tests that the gap affects as `blocked` and continues the other tests. `return_to_oracle` stops all further actions and closes the remaining tests as `blocked`. Use it when one gap can make all other results wrong, for example a wrong build. Checkmate records the policy. The agent applies it.
- A retest needs a new run ID and a new build. `run begin` records the open defects of the earlier run in the request as `retestDefects`.
- Give `--instance` when the target has two or more active instances. `run begin` refuses the run without it. `run gate` does not take `--instance`.
- For a matrix, begin one run of the same plan revision for each instance, for example `run-uat` with `--instance uat` and `run-staging` with `--instance staging`.

## Lite mode

Lite mode keeps Checkmate as the record and the gate, but not as the test method. The agent tests freely and records each build in one call or in parts. One agent session does all of the steps, with the `lite` skill or with `lite guide`:

1. Before the build, `lite checklist` records the checklist items (the requirements) and the questions (non-blocking gaps). The target profile must have `"approvals": {"plan": "none", ...}`. Lite mode has no setup, plan approval, or revise stage.
2. The oracle answers each question with `gap answer`.
3. After each build, `lite show` prints the answers, the repeat lines, and the open defects. Then `lite record` records the build. A call with `--draft` saves a part of the record. The last call without `--draft` completes the build.

The checklist states `criteria`, the count of numbered acceptance criteria in the ticket. An item with `"criterion": <n>` is the item of criterion `n`. Checkmate stores its source as `<ticket file>#ac-<n>` and the number in the metadata `criterion`. `lite checklist` refuses the checklist when a number from 1 to `criteria` has no item.

An item with a `baseline` is a regression item. The baseline has the exact request or steps, the value on the base app, and the value that the docs state. Checkmate stores them in the metadata `baselineSteps`, `baselineValue`, and `documented`. The baseline value is the reference value of the item.

An item without a baseline gets a reference value from a build record: the `value` of its first passed check. A check with an `intended` change also sets a new reference value. Checkmate stores the value in `baselineValue`, the steps in `baselineSteps`, and the build in `baselineBuild`. `lite show` and `lite guide` print one `repeat` line for each item with a reference value: the steps, the reference value, and where it comes from (`checklist` or `build <build>`).

The optional field `changes` of the checklist and of the record lists the areas that the diff or the ticket changes, each with a `source` and the `items` that cover it. Checkmate stores the list in the plan revision as `changes` and adds the entries of each record. `lite show` and `lite guide` print a `suggest` line for each area that no item covers. No rule of Checkmate needs this field.

`lite guide [<planId>]` prints what an agent needs without a skill. The text comes from the `description` and `examples` of the two lite schemas. Without a plan, or for a plan without a checklist, the next step is `lite checklist`: the guide prints the three steps, the command, each payload field with its description, an example, and `next:` lines. For a plan with a checklist, the next step is `lite record`. The guide prints the fields of the record, the `lite show` lines without the item sources, and `need` lines. When the plan has a run, the guide prints only the `checks` and `retests` fields, as one line each, and no `item` lines or resolved questions. It prints the entry fields of `items`, `defects`, `retests`, `questions`, and `changes` as one line each, and the `retests` field only when a defect is open. It prints the example until the plan has a run, and then only the command. Each `need` line names a field and the items or open defects that the record must give it. `lite show` ends with `next:` lines.

`lite checklist` also accepts a plan that `plan open` opened and that has no revision. It keeps the open request and the target of that request.

`lite record --draft` checks the payload against the schema and saves it as a part of the record of the build. It does not store a revision or a run. It prints the count of each field in the parts and a `missing` line for each rule that the full record does not satisfy yet. The parts of the drafts and of the last call make one record. A part replaces an earlier part with the same `id`, the same `defect` in `retests`, the same `area` in `changes`, or a check with the same `item` and `check`. The drafts of a build stay until the build has a record. A refused call saves nothing.

`lite record` without `--draft` stores one transaction:

- A new plan revision. It applies the pending decisions and adds the new items and questions. It has one test for each check. A check test has the ID `<item>-<n>`, one assertion `A1`, and the metadata `recordedBy: lite`.
- A finished run `<planId>-run-<n>` that selects each test of the revision. A later run is a retest of the run before it.
- For each retest verdict, the earlier tests of the defect again, with the result `passed` (fixed) or `failed` (not fixed). The new run records a not-fixed defect again with the same ID.

`lite record` refuses a record when:

- an item has no check, or a criterion item has only `not_run` checks,
- a check has no `result`, and it is not a check with `value` on an item with a reference value,
- an item with a reference value has no check with `value` and no `blocked` check with a `reason`,
- a check has no `check` text, and it is not a check of an item with a reference value,
- the `value` is not the reference value, and the check has no `defect`, no `intended` change, and no `result` other than `failed` with a `reason`,
- the `result` of a check with `value` is not the result that Checkmate sets from the value,
- `changes[].items` names an unknown item,
- a failed check has no defect, or a defect has no failed check or no evidence,
- an evidence path names no file,
- an open earlier defect has no retest verdict with evidence,
- the build already has a record.

For a check with `value` on an item with a reference value, Checkmate sets the result. It removes the spaces at the two ends of each value, changes each sequence of spaces to one space, and writes each number in one form: it removes the zeros before the integer part and after the decimal part, so `1.50` is `1.5` and `007` is `7`. All other text, letter case, and units must be the same. It does no other matching. Equal values give `passed`. Different values give `failed` with the `defect` of the check, or `passed` with the `intended` change. When the difference is not in the rule, for example a generated ID or data that the tests changed, the check gives its own `result` (`passed`, `blocked`, or `not_run`) and a `reason`. Only an `intended` change or the first passed value sets a new reference value. A check of an item with a reference value can leave out `check`: Checkmate uses the steps of the repeat line. It adds the value, the reference value, the intended change, and the reason to the `observed` text of the check. The refusal has a `reason` and a `hint`. When the record breaks more than one rule, the reason and the hint list each rule with a number, for example `(1)` and `(2)`. The hint gives the JSON fragment to add when it can. The reason or the hint names the payload field, for example `checks[1].defect` or `retests[].evidence`. Nothing is recorded. When the plan has no checklist, `lite show` and `lite record` refuse with a hint to run `lite checklist`. Evidence is a file path in the workspace, a short text, or `{"text": "<what you saw>"}`. A string with a space that names no file is text. One file can be the evidence of several checks. Checkmate does not delete the file.

`status`, `run show`, `finding list`, `export`, the review UI, and `result accept` read lite records as they read other records. The `next` lines of `status` name the commands of the full loop.

## Journal mode

Journal mode is a prototype. The commands have the prefix `journal`, because `log` and `export` are names of other commands. The agent tests freely and writes down what it sees. The journal has no checklist step, no finish step, no completeness refusal, and no `blocked` or `not_run` state.

1. The opener runs `journal open <changeId> --target <targetId>`. The target must exist. The opener can log criteria with `journal log`.
2. The agent runs `journal guide <changeId>`. The guide comes from the `description` and `examples` of `plugin/contracts/journal-*.schema.json`. It prints each field description one time. A later field with the same description shows only its name. No output of a later command tells the agent to read the guide again.
3. The agent runs `journal log` at any time, in any order. Standard input is one entry, a JSON array of entries, an object with an `entries` array, or one entry on each line. Checkmate removes a Markdown code fence around the JSON and a comma before `}` or `]`. When the array is not valid JSON, Checkmate reads each entry alone. The build is in the entry or in `--build`. Checkmate saves each valid entry and refuses each invalid entry alone, with its index, the field, a hint, and `fix`: the entry with each bad field corrected or removed. A call that saves no entry is refused. A call that saves one or more entries completes. When it refuses no entry, it prints one line: `completed <changeId> saved=<IDs>`. Else that line also has `refused=<count>`, and a `refused` line follows for each refused entry. It prints nothing else: the agent runs `journal gaps` to read what the record does not show yet.
4. The agent runs `journal gaps` at any time. `gaps` always completes, and no command needs it to be empty.
5. The oracle runs `journal answer`, `journal accept`, and `journal reject`.

The entry kinds are `criterion`, `observation`, `defect`, `question`, `verdict`, and `note`. The merger also logs `issue`: read [Several testers](#several-testers). Checkmate gives an ID with the prefix `C`, `O`, `D`, `Q`, `V`, or `N` when the entry has no `id`. An entry with `supersedes` replaces the earlier entry of the same kind and keeps its ID. Nothing is deleted: `journal export` has each version in `history`. Evidence is a file path in the workspace or a text. Checkmate stores the bytes of each file in `blobs`. A string with a space or `://`, or a string that does not look like a path, is text. The `source` of a criterion and the `saw` of a verdict are optional.

A defect with `saw`, `value`, or `via` is also the observation that shows it. Do not log that observation again. The views count such a defect as an observation marked `wrong`, about its `about` and the criteria in its `links`. Its `saw` is its `actual` when it has no `saw`. A defect without these fields is not an observation.

An observation with a `value` on an earlier build is a baseline. When an observation or a defect with a `value` has no `repeats`, Checkmate links it to one earlier observation with a `value` when exactly one chain of repeats matches: the same `about` and the same `steps`, without letter case and extra spaces, or the same ID without the build name at the end (`total-b1` and `total-base` or `total`). Checkmate saves the rule in `linked`. With two or more matches it links nothing. `"repeats": "none"` stops the link.

Open items are things the record does not show yet. Only `journal gaps` prints them. Each kind gets one line first, and the other lines follow the rank. `journal gaps` prints at most 8 lines of each kind and at most 40 lines, then a `count` line and a `not_shown` line with the count of each kind that it does not show. For a tester, the `not_shown` line does not point to `--all`, because `--all` shows the entries of the other testers. An item shows on one line only. The kinds, in rank order:

- `difference`: a repeat with another value and no note or defect about it. A defect that repeats a baseline explains its own difference. Checkmate compares the values as `lite record` does: it removes spaces at the two ends, changes each sequence of spaces to one space, and writes each number in one form.
- `baseline`: an observation with a `value` on an earlier build that no observation on the build repeats, with its steps.
- `baselines`: on the first build of the change, fewer than 3 observations have a `value`. The idea lists the existing rules near the change that are worth a baseline. `baseline_area`: on the first build, a changed area with no baseline about it.
- `wrong`: an observation marked `wrong` with no defect or note about it.
- `unverified`: a suspected defect that no observation shows on the running app, or a defect that only `via: code` observations show. `evidence`: a defect of the build without evidence.
- `open_end`: a note or an observation of the build that says that something is not tested, not verified, not captured, not covered, skipped, or `TODO`, with no entry about it.
- `retest`: a defect of an earlier build with no verdict on the build, unless an earlier verdict is `fixed`.
- `build`: the build has no observation. `value`: on `base`, an observation without a `value`.
- `criteria`: the journal has no criterion. `criterion`: a criterion has no observation on the build. `happy_path`: it has one observation, or only `ok` observations.
- `area`: a changed area (the `area` of a criterion or a note) that no observation on the build is about.
- `answer`: a PM answer that no observation on the build is about. An answer that only sends the agent to the ticket or the docs, for example "No decision; use the ticket and existing docs.", has no decision and gives no item.
- `entry_point`: no observation on the build used the UI (capability `browser`) or the API (capability `http`) of the target, or a criterion was observed only through some of them.

On `base`, the lines `criteria`, `criterion`, `happy_path`, `answer`, and `area` do not show, because the change is not built. An observation is about an ID when its `about` is the ID or has the ID as a word.

`journal show` prints the criteria, a matrix of the observations for each criterion or `about` on each build, the defects with their verdicts, the questions with their answers, and the decisions. `journal accept` and `journal reject` print the gaps of the build at the time of the decision.

### Several testers

Two or more agents can test one change. Each agent tests alone and logs into the same journal. The merger then merges what they found. Checkmate does not limit how an agent tests.

- Each agent has its own actor. Set it with `CHECKMATE_ACTOR`, for example `qa:a1`. Each entry stores its actor.
- A tester is an actor whose name starts with `qa:`, except `qa:merge` and `qa:verify`. All other actors are not testers: for example the opener, the PM, `qa:merge`, and `qa:verify`. Open the change and log the shared criteria with an actor that is not a tester.
- The short name of an actor is the part after the last colon: `qa:a1` has the short name `a1`. Use a different short name for each actor.
- Entry IDs are unique for each actor. Two testers can both log `D1`. The full ID is `<short name>/<id>`, for example `a1/D1`. An actor can use the bare ID of its own entry in each field that names an entry. To name the entry of another actor, use the full ID. A bare ID that names the entry of another actor is saved as the full ID.
- A tester sees its own entries, the entries of the actors that are not testers, the PM answers, and the decisions. `journal guide`, `show`, `gaps`, and `export` do not show the entries of the other testers. `--all` on `show`, `gaps`, and `export` shows all entries. An actor that is not a tester sees all entries. A view shows the bare ID of an entry when no other entry in the view has the same ID, and the full ID when one has.
- A tester can run its commands in a subfolder of the workspace, for example `workspace/a1`. Checkmate finds `.checkmate` in a parent folder. An evidence path is relative to the current folder or to the workspace.
- Several `journal log` calls can run at the same time. Each call waits for the database lock.

An `issue` entry says that two or more defect entries describe the same defect: `{"kind": "issue", "title": "...", "severity": "high", "reports": ["a1/D1", "a3/D2"]}`. Checkmate gives an ID with the prefix `I`. To add or remove a report, log the issue again with `supersedes`. A defect that is in no issue is its own issue, with the full ID of the defect.

1. The merger runs `journal guide <changeId> --role merger`, then `journal merge <changeId> --build <build>`. `merge` prints each defect of the build from all testers: the full ID, the severity, the title, `expected`, `actual`, and the criteria that it links to directly or through a linked observation. It prints at most 60 defects. Then it prints the `suggest` lines, the `may_belong` lines under the heading `singles that may belong to a larger issue`, an example, and three `check` lines: the defects in no issue, the `suggest` lines that are not logged, and the count of `may_belong` lines. A `suggest` line is a group of defects of two or more actors that link to the same criterion, or whose title and `actual` have many of the same words: half or more of their words of three or more letters are the same. A `may_belong` line names a defect that only one tester reported and an issue or a `suggest` group of two or more testers with some of the same words: a quarter or more. When both defects have steps, the steps must also have a quarter or more of the same words, or the same path, for example `/api/cart`. A `suggest` line and a `may_belong` line are ideas, not rules. When the build has one or more issues, `merge` prints only the `suggest` lines, the `may_belong` lines, and the `check` lines. The merger does not test.
2. The verifier runs `journal guide <changeId> --role verifier`, then `journal verify <changeId> --build <build>`. `verify` prints two kinds of items, with the steps, `expected`, `actual`, and the evidence of the best report. The reason is `one reporter`: one tester reported the issue on the build, and no other actor confirmed or refuted it on the build where it was found. Or the reason is `disputed verdict` or `single verdict`: the status of the issue on the build is `disputed` or `single`. The verifier reproduces each item on the running application, and logs one observation for each item with `"confirms": "<ID>"` or `"refutes": "<ID>"` and `saw`. The ID is the ID of an issue or of a defect. The verifier does not explore beyond the list.
3. A verdict on a later build can name an issue or a defect.
4. `journal issues <changeId> [--build <build>]` prints one line for each issue: the ID, the severity, the title, the number of testers that reported it and their short names, the status on each later build, and `confirmed`, `unconfirmed`, or `refuted`. With `--build`, it prints only the issues with a report on that build. With `--json`, each issue has `id`, `title`, `severity`, `build`, `expected`, `actual`, `steps`, and `evidence` from the best report, `reports` (full IDs), `reporters` (the count), `actors`, `confirmed`, `refuted`, `verified` (`confirmed`, `refuted`, or `none`), `statuses`, and `note`. `statuses` has an object for each later build: `status` (`fixed`, `not_fixed`, or `no verdict`), `votes` (`fixed` and `not_fixed`, the count of testers), and `basis` (`majority`, `disputed`, `single`, `verified`, or `none`). The text line prints a status as `fixed (2 of 3)`, `not_fixed (1 of 1, single)`, `fixed (1 of 2, disputed)`, or `fixed (verified)`. The best report is the report with the most evidence, then with steps.

- `verified` comes from the last observation of an actor that did not report the issue, on the build where the issue was found, that confirms or refutes the issue or one of its reports. An issue is confirmed when two or more actors reported it, or when `verified` is `confirmed`. An issue is refuted when it is not confirmed and `verified` is `refuted`. A refuted issue stays in the record.
- The status of an issue on a later build comes from the verdicts on that build that name the issue or one of its reports. Each actor has one vote: its last verdict. The status is the result of most votes, with the basis `majority`. With one vote, the status is that result, with the basis `single`. With a tie, the status is `fixed`, with the basis `disputed`. With no vote, it is `no verdict`.
- An observation of an actor that did not report the issue, on a later build, settles the status on that build, with the basis `verified`. `confirms` means that the defect is still there: `not_fixed`. `refutes` means that the verifier could not reproduce it: `fixed`.
- When the journal has a tester, `journal gaps` for an actor that is not a tester, `accept`, and `reject` also print `unconfirmed`: an issue that is not confirmed and not refuted, and `no_verdict`: an issue with the status `no verdict` on the build, unless it is `fixed` on an earlier build.
- `journal export` has `issues`, with their reports and statuses.

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

**Deadlines.** `--timeout` sets the deadline in seconds, from 1 to 3600. Another value gives `invalid_request`. Setup, plan, and revise use 300 seconds by default. Execute uses the seconds that remain of the run deadline, at least 1. The execute prompt gives the run deadline in UTC and the remaining seconds. It has no second deadline. The other prompts give the deadline in UTC and tell the worker to check the time with `date -u`. The launcher stops the worker's process group at the deadline, on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

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
