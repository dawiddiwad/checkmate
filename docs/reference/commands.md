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

| Group     | Command                                                                                      | Does                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| State     | `init`                                                                                       | Creates `.checkmate/checkmate.db`. Any command does this too.                                                                     |
|           | `inbox`                                                                                      | Lists what waits for the oracle.                                                                                                  |
|           | `status <planId>`                                                                            | Prints the loop state of one plan.                                                                                                |
|           | `log [--subject <s>] [--limit <n>] [--after <rowid>]`                                        | Lists the operation log, newest first. The limit is 1 to 1000. The default is 50.                                                 |
|           | `query "<sql>"`                                                                              | Runs one SQL statement on a read-only connection. It refuses a second statement, a write, and a statement without result columns. |
| Target    | `setup --url <url> [--target <id>] [--instance <name>]`                                      | Sets up a target from a URL with defaults in one step. Read [setup](#setup).                                                      |
| Target    | `target open <targetId>`                                                                     | Records a setup request.                                                                                                          |
|           | `target request <targetId>`                                                                  | Prints the setup request.                                                                                                         |
|           | `target save <targetId>`                                                                     | Saves a profile from standard input.                                                                                              |
|           | `target list`                                                                                | Lists each target with its latest revision and instances.                                                                         |
|           | `target show <targetId[@rev]> [--instance <id>]`                                             | Prints a profile, and the values of one instance.                                                                                 |
|           | `target instance add <targetId> <instanceId>`                                                | Adds an instance from `--entry` flags or standard input.                                                                          |
|           | `target instance retire <targetId> <instanceId>`                                             | Retires an instance. No new run can start on it.                                                                                  |
|           | `target instance list <targetId>`                                                            | Lists the instances of a target, active and retired.                                                                              |
| Plan      | `plan open <planId> --target <targetId@rev>`                                                 | Records a plan request.                                                                                                           |
|           | `plan request <planId>`                                                                      | Prints the request with the resolved tools.                                                                                       |
|           | `plan save <planId>`                                                                         | Saves revision 1 from a candidate.                                                                                                |
|           | `plan show <planId[@rev]>`                                                                   | Prints a revision. Without `@rev`, the latest.                                                                                    |
|           | `plan list`                                                                                  | Lists each plan at its latest revision.                                                                                           |
|           | `plan pending <planId>`                                                                      | Prints the pending decisions and the tests they affect.                                                                           |
|           | `plan revise <planId>`                                                                       | Saves the next revision from a delta.                                                                                             |
|           | `plan diff <planId> <from> <to>`                                                             | Prints the field changes and a JSON Patch.                                                                                        |
| Decisions | `gap answer <planId> <gapId>`                                                                | Records an answer to a gap.                                                                                                       |
|           | `plan edit <planId@rev> [--patch]`                                                           | Changes the latest revision.                                                                                                      |
|           | `plan edit <planId> --patch`                                                                 | Corrects the derived rules of a plan without a revision. Read [Derived rules](#derived-rules).                                    |
|           | `plan adopt-gaps <planId@rev> --run <runId>`                                                 | Adds the gaps of a run to the plan.                                                                                               |
|           | `plan approve <planId@rev>`, `plan reject <planId@rev>`                                      | Records a verdict on the latest revision.                                                                                         |
|           | `result accept <runId>`, `result reject <runId>`                                             | Records a verdict on a result.                                                                                                    |
| Run       | `run gate <planId@rev>`                                                                      | Checks the gate. Records nothing.                                                                                                 |
|           | `run begin <runId> <planId@rev>`                                                             | Checks the gate and starts a run on one instance.                                                                                 |
|           | `run check <runId> <testId> <assertionId>`                                                   | Records one assertion result with evidence.                                                                                       |
|           | `run close <runId> <testId>`                                                                 | Closes a test and derives its outcome.                                                                                            |
|           | `run finding <runId>`, `run gap <runId>`                                                     | Records a finding or a new gap from standard input.                                                                               |
|           | `run finish <runId>`                                                                         | Checks the run and stores the result.                                                                                             |
|           | `run resume <runId>`                                                                         | Records a new attempt for a stalled run.                                                                                          |
|           | `run show <runId>`, `run list`                                                               | Prints a run, or lists runs.                                                                                                      |
|           | `finding list [--plan <planId>] [--open]`                                                    | Lists the findings of all runs, one line for each finding.                                                                        |
| Test      | `test <planId> --build <build> --allow <rule>`                                               | Tests a change: explores the build, and in regression mode also begins a run of the stored tests. Read [test](#test).             |
| Explore   | `explore start <planId> --build <build> --allow <rule>`                                      | Records an exploration and starts its explorers in the background. Read [Explore](#explore).                                      |
|           | `explore next <explorationId>`                                                               | Session path: prints the actions that are due now for the agents of the host session. Read [Session path](#session-path).         |
|           | `explore started <explorationId> <names...>`                                                 | Session path: records that the given steps of these agents run.                                                                   |
|           | `explore pause <explorationId> --reason <text>`                                              | Session path: records that the run waits for the person. The next `next`, `started`, or `done` clears it.                         |
|           | `explore done <explorationId> <name> <step>`                                                 | Session path: records that the step of an agent ended, and reads its answer file. Read [Session path](#session-path).             |
|           | `explore status <explorationId>`                                                             | Prints the state, the level, the model, and each explorer.                                                                        |
|           | `explore wait <explorationId> [--timeout <s>]`                                               | Waits until the exploration ends, and prints the status.                                                                          |
|           | `explore stop <explorationId> [--explorer <name>] [--reason <text>]`                         | Stops a running exploration, or one tester of it. Read [explore stop](#explore-stop).                                             |
|           | `explore permit <explorationId> <requestId> --allow\|--allow-kind\|--always\|--deny\|--stop` | Answers a permission request of a tester. Read [explore permit](#explore-permit).                                                 |
|           | `explore permissions <explorationId>`                                                        | Lists the permission requests of an exploration and their answers.                                                                |
|           | `explore follow <explorationId>`                                                             | Resumes each explorer session for one more turn with the new answers of the oracle. Read [explore follow](#explore-follow).       |
|           | `explore levels`                                                                             | Prints the test levels: explorers, model alias, verifier, and the seconds of the study, test, and follow-up turns.                |
|           | `explore open <planId> --build <build>`                                                      | Records an exploration without explorers.                                                                                         |
|           | `explore finish <explorationId>`                                                             | Merges and verifies the recorded sessions of an exploration without explorers.                                                    |
|           | `explore show <explorationId>`                                                               | Prints the exploration with its claims, questions, and criteria.                                                                  |
|           | `claim list <planId> [--all]`                                                                | Lists the open claims of a plan with their state, build, expected, and actual results. `--all` lists the closed claims too.       |
|           | `claim accept\|reject <planId> <claimId> --rationale <text>`                                 | Records the decision of the oracle on a claim.                                                                                    |
|           | `claim handoff <planId> <claimId...> --to <text>\|--undo`                                    | Records that claims went to a developer or a tracker, or undoes it. Read [Hand-over](#hand-over).                                 |
|           | `export exploration <explorationId> --format md\|json`                                       | Prints the report of an exploration.                                                                                              |
|           | `harvest <explorationId> [--observations]`                                                   | Stores the kept claims of an exploration as tests of its plan. Read [harvest](#harvest).                                          |
|           | `record <explorationId> --explorer <name> --session <id>`                                    | Starts a recorder: a copy of a test session that writes the record of that session.                                               |
|           | `explore log <explorationId>`                                                                | Saves each valid entry from standard input for the actor, and refuses each invalid entry alone.                                   |
| Output    | `export plan <ref>`, `export run <runId>`                                                    | Prints a report as `md`, `html`, `json`, or `junit` (run only).                                                                   |
|           | `evidence get <evidenceId> --out <file>`                                                     | Writes the evidence bytes to a new file.                                                                                          |
|           | `ui`                                                                                         | Starts the review UI.                                                                                                             |
| npm only  | `delegate <stage> <subject>`                                                                 | Runs a stage in a new Claude Code session.                                                                                        |

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

`checkmate status <planId>` derives the loop state from the records. Checkmate stores no loop state. Line 1 has `state=` and `waitsOn=`, and `run=` names the latest run in begin order. Then come `why` lines, one `rules` line when the rules of the plan were [derived](#derived-rules), `next` lines, one `started` line for each open run, the open gaps, the pending decisions, the [open defects](runs.md#open-defects) of the ready tests, and the [retest verdicts](runs.md#retest-verdicts) of the latest retest in begin order, while one of its defects is open or while it is the latest finished run. A `started` line names the run, the build, and the instance. A matrix of five runs on five instances prints five `started` lines.

```text
completed checkout state=needs_revision waitsOn=planner revision=2 approval=pending run=run-1
why	G1 has a pending clarify decision
next	checkmate delegate revise checkout --allow Read --allow Bash
01M7CVYCKGM0TNPWADTFZGRZ0J	pending	G1	clarify
```

| State               | Waits on | Meaning                                                                                                                                                                                                        |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready_to_test`     | qa       | The plan request has no revision. The `next` line is `checkmate test <planId> --allow Read --allow Bash`. A `why` line names the last exploration and why it failed. To store tests first, use the plan stage. |
| `run_in_progress`   | qa       | One or more runs of the plan are started.                                                                                                                                                                      |
| `needs_revision`    | planner  | A gap answer waits for the revise stage.                                                                                                                                                                       |
| `plan_rejected`     | oracle   | The latest revision is rejected. Change the plan. The `why` line gives the actor and the rationale.                                                                                                            |
| `needs_answers`     | oracle   | A gap or a run gap is open without an answer.                                                                                                                                                                  |
| `needs_approval`    | oracle   | The latest revision waits for approval.                                                                                                                                                                        |
| `ready_to_run`      | qa       | The latest revision is approved or needs no approval, no run is finished, and the gate can select a test.                                                                                                      |
| `nothing_to_run`    | oracle   | No test is ready, or the gate cannot select a test that needs a run. The `why` lines name the blockers.                                                                                                        |
| `nothing_to_run`    | qa       | As above, and a cross-plan dependency blocks a test. The `next` line names `checkmate status` of the other plan.                                                                                               |
| `defects_open`      | factory  | A ready test has an open defect. Build a fix, then retest.                                                                                                                                                     |
| `needs_retest`      | qa       | A ready test has not run on the latest revision, a latest outcome is not `passed`, or a latest pass is in a rejected run. Or a run that status uses did not complete.                                          |
| `awaits_acceptance` | oracle   | Each ready test passed in its latest run. One or more of these runs wait for acceptance. The `why` lines name them.                                                                                            |
| `accepted`          | none     | The oracle accepted each run that has the latest outcome of a ready test.                                                                                                                                      |
| `passed`            | none     | Each ready test passed in its latest run. Result acceptance is not required.                                                                                                                                   |
| `exploring`         | qa       | An exploration of the plan runs. The `next` line is `checkmate explore wait <explorationId>`.                                                                                                                  |
| `needs_triage`      | oracle   | A blocking exploration question has no answer, or a claim is `suspected` or `unresolved`.                                                                                                                      |

The exploration states apply only when the check state is `ready_to_test`, `ready_to_run`, `nothing_to_run`, `needs_retest`, `passed`, or `accepted`. Then `exploring` comes first, then `needs_triage`, then `defects_open` for an open claim that is `observed`, `confirmed`, or `accepted`. After a finished exploration, the `next` lines are, in this order: the claims that are ready for the factory, with `checkmate claim list <planId>`; the open questions, which can be answered at any time and do not block; `checkmate harvest <explorationId>`; and `checkmate test <planId> --build <new build>` to retest on the next build. `status` also prints one `exploration` line for each exploration, one `question` line for each open question, and one `claim` line for each open claim. `status` and `inbox` count only the claims and questions of completed explorations. The raw entries of a running exploration or a running follow-up wait until it is completed.

When the oracle rejected the latest revision, or a run that has a latest outcome of a ready test, a `why` line gives the decision: `<subject> was rejected by <actor>: <rationale>`. Address the rationale in the next revision or the next run.

A `next` line is a hint for a person or an agent. Do not parse it. Replace each `<placeholder>` with a value, and the command runs. The gate does not refuse a `run begin` hint. A state can give more than one `next` line: one `delegate execute` for each started run, one retest for each run with open defects, one rerun for each run that gives a `needs_retest` reason, and one `result accept` for each run that waits. `--json` gives `next` as a list. A `delegate` hint has the minimum rules `--allow Read --allow Bash`. When the target has two or more active instances, a `run begin` hint has `--instance`: the instance of the earlier run when it is still active, else `<instanceId>`. A rerun uses the build and the instance of the run that needs it. When that instance is retired, the rerun is a retest on a new instance with `--retest-of` and the same build. When a test has a cross-plan dependency, a `run begin` hint names the build on which the dependencies select the most tests, and the newest build on a tie.

`--json` also gives `stage`: the `delegate` stage that the plan waits on. It is `revise` for `needs_revision`, `execute` for `run_in_progress`, and `none` for every other state. The subject of `plan` and `revise` is the plan ID. The subjects of `execute` are the run IDs in `openRuns`, one for each started run. `latestRun` is the latest run in begin order.

`status` tries the states in this order and prints the first one that applies. Before the first finished run, only an open blocking gap gives `needs_answers`. After a finished run, an open blocking gap gives `needs_answers` first, then open defects give `defects_open`, then an open non-blocking gap gives `needs_answers`. `status` looks only at the tests of the latest revision that are `ready`. A ready test whose local prerequisite is deferred, directly or through a chain of prerequisites, counts as deferred. A `why` line names it, for example `T2 deferred: prerequisite T1 is deferred`, and `run gate --partial ready_only` leaves it out with that reason. When no test is ready, the plan has verified nothing, also after a finished run. Then the state is `nothing_to_run`. It waits on the oracle to change the plan or to answer the deferred gaps, and the `why` lines name each deferral. `accepted` and `passed` need one or more ready tests. A deferred test or a removed test does not keep the plan in `defects_open` or `needs_retest`. A started run changes no outcome and closes no defect. Before the first finished run, a plan is `ready_to_run` when the gate can select a test with `--partial ready_only`. After it, a ready test that has not run gives `needs_retest`. An approved revision with open gaps is `ready_to_run` until its first run finishes. The `why` lines name each run in begin order.

**Latest outcomes.** Checkmate orders runs by the time that they began, not by the time that they finished. An outcome counts for the latest revision only when the run's revision has the same definition of the test: the same `action`, `preconditions`, `assertions`, `dependsOn`, `capability`, `operations`, and `requirementIds`, and the same text of each of these requirements. Thus a changed requirement text, or a new requirement of a test, needs a retest. Else the test has not run on the latest revision. A new revision that changes only other fields, for example a title, keeps every outcome. It needs no rerun. A later run replaces the outcome of an earlier run for a test only when it is on the same instance, on a different build, or a retest in the chain of the earlier run. Thus a build can have one latest outcome for each instance. Each one must be `passed`. On the same build, a pass on one instance does not hide a failure on another instance.

**Nothing to run.** When `needs_retest` or `ready_to_run` would apply, `status` uses the selection of `run gate --partial ready_only`. Checkmate tries the build of each run that needs a rerun, then each build on which a cross-plan dependency passed, newest first. When the gate cannot select a test that needs a run on any of these builds, the state is `nothing_to_run`. The `why` lines give the reason for each test that the gate leaves out, for example a deferred prerequisite. For a cross-plan dependency that has not passed, `status` waits on `qa`, and the `next` line is `checkmate status <otherPlanId>`. Else it waits on `oracle`, and the `next` line is `plan edit --patch`.

## setup

```sh
checkmate setup --url <url> [--target <targetId>] [--instance <name>] [--operations <a,b>] [--environment <text>]
```

`setup` records the setup request, saves profile revision 1, and adds the instance in one step. It prints each value that it assumed on an `assumed:` line:

| Value              | Default                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target ID          | The host and the port of the URL, in lower case, with each other character changed to `-`, for example `localhost-3000`. `--target` overrides it. |
| Instance           | `local`                                                                                                                                           |
| Entry point        | `web`, kind `url`, with the URL as its value.                                                                                                     |
| Capabilities       | `http`, and `browser` when `playwright-cli` is on `PATH`. The tools are `node` and `playwright-cli`.                                              |
| Allowed operations | `any_test_operation`                                                                                                                              |
| Reset              | None.                                                                                                                                             |
| Authentication     | None.                                                                                                                                             |

`setup` sends one `GET` to an `http` or `https` URL. When the application does not answer, the profile has `readyForLiveExecution: false`. When the target exists, `setup` changes no profile and adds the instance only when it is new.

**Any test operation.** `any_test_operation` in `allowedOperations` permits any action that the application offers to a test user, on test data, in this instance. The plan check and the gate accept each operation of a test. An explicit list is the strict form. Checkmate refuses `any_test_operation` for a production instance: an instance whose ID or environment starts with `prod`, in any letter case. Give an explicit list with `--operations` for it.

## test

```sh
checkmate test <planId> --allow <rule> [--build <build>] [--url <url>] [--mode exploratory|regression|auto] [--level <level>] [--explorers <n>] [--instance <id>] [--since <git ref>] [--until <git ref>] [--repo <dir>] [--scope <a,b>] [--claude-arg <arg>] [--timeout <seconds>] [--objective <text> --target <targetId> --source <source> --instructions <text>]
checkmate test <planId> --session [the same options without --allow, --claude-arg, and --timeout]
```

`test` does the common sequence in one command:

1. Without `--build`, it uses `git rev-parse --short HEAD`. Without git, it uses the date and time in UTC, for example `local-20261116-1530`.
2. When the plan has no request, it records one from `--objective`, `--target` (the latest revision), `--source`, and `--instructions`, for example the way that a tester signs in. Do not put a secret value in it. It needs `--source` or `--objective`. Without `--objective`, the objective is `Test the change that <sources> describes.` Without `--target`, it uses the only target. When the store has no target, it runs `setup --url <url>` first, and needs `--url`.
3. It prints each assumed value on an `assumed:` line, the values of `setup` too.
4. It chooses the mode. `--mode auto` is the default. The rule: when the plan has no exploration and no finished run, the mode is `exploratory`. Else it is `regression`.
5. It starts an exploration, as `explore start` does, with the mode. `--since` and `--until` give the change, as in `explore start`. Without `--since`, when the workspace (or `--repo`) has a default branch of `origin` (`refs/remotes/origin/HEAD`) that is an ancestor of the checked-out commit and not equal to it, `test` uses that branch as `--since` and prints `assumed: since=<branch> (...)`. Else it prints `assumed: since=none (no diff is given: ...)`. `--scope` gives the changed files as a list, in place of the files of the diff.
6. In `regression` mode, when the plan has a revision, it begins a run of the ready tests of the latest revision with the next free run ID, for example `run-2`. When the gate refuses, no run starts, and `check_skipped` lines give the reasons. When the plan has no revision, the test is a plain retest: the testers get the known-state file and the diff. `test` prints one line `stored_tests none, the testers retest the earlier findings`, and nothing waits on a decision. `harvest` is an option at any time, not a step before a test.

Output: line 1 has `mode=`, `level=`, `explorers=`, `model=`, `verifier=`, `path=session` with `--session`, and `run=` when a run began. The `next` lines name the execute stage for the run and `checkmate explore wait <explorationId>`, or `checkmate explore next <explorationId>` with `--session`. The JSON has `chosenBy`: `auto` or `flag`, and `path`: `process` or `session`.

**Two paths.** Without `--session`, the testers run as new Claude Code processes in the background (the process path). Use it in a shell without a Claude Code session, for example in CI or in a factory. With `--session`, `test` opens the same exploration, with the same charter, level, known-state file, and work folders, but starts no process. The operator agent of a Claude Code session starts the testers as its own agents, and they show in the session and count in its usage (the session path). Read [Session path](#session-path).

### Derived rules

A plan request from `--source` only has no rules. Before the first testers of such a plan start, a clerk reads the sources and writes numbered rules: `R1`, `R2`, and so on, one sentence each, with the source file and the place in it, and a short area. An area is a name of one to three words, for example `Approval`. The clerk uses at most nine areas for one plan and puts each rule in one area. Checkmate gives the clerk the text of each source file in the workspace. Checkmate checks the rules: each ID is `R<n>` and is unique, each rule has text, each source starts with a source of the request, and each rule has an area of 1 to 40 characters. Areas that differ only in case are one area, with the first spelling. A reply with more than nine areas is refused too. It refuses the reply with the reasons one time, and the clerk sends all the rules again. Checkmate then stores the valid rules on the plan, with the origin `derived`.

- On the process path, the step is one call with no tool rules before the explorers, and one more call for the repair.
- On the session path, the step is one more action of `explore next` for the clerk agent: `start rules rules agent=checkmate:clerk`. Read [Session path](#session-path).
- A plan with requirements in its request or its revision skips the step. A plan with derived rules skips it too, so the rules stay the same for each later build. When Checkmate cannot read a source file, it skips the step.
- When the step fails, the testers start without rules.
- The charter of the exploration and the briefs of the testers list the rules. The recorder ties its entries to them.
- `status` prints one line: `<n> rules were derived from the sources. Correct them with checkmate plan edit <planId> --patch.`
- To correct the rules, send a patch with only `requirements` to `checkmate plan edit <planId> --patch`, without a revision. Checkmate stores the corrected rules with the origin `corrected`. A later revision of the plan replaces the derived rules. A patch can set `area` of a rule. A rule without an area, for example in a store of an earlier version, is in the area `Rules`. The briefs of the testers do not show areas.

## Explore

An exploration is free testing of one build of a plan. The plan needs a request. It does not need a revision or an approval. A tester of an exploration does not use Checkmate. A recorder writes the record after the test session.

`explore start` and `checkmate explore open <planId> --build <build> [--instance <id>] [--mode exploratory|regression]` record an exploration with the next free ID, for example `x-1`. It uses the only active instance when you give no `--instance`. It stores a charter from the plan request and the target profile: the goal, the requirements, the sources, the capabilities, the allowed operations, and the tools.

### explore start

```sh
checkmate explore start <planId> --build <build> --allow <rule> [--allow <rule>] [--level smoke|normal|deep] [--explorers <n>] [--minutes <n>] [--instance <id>] [--mode exploratory|regression] [--since <git ref> [--until <git ref>] [--repo <dir>]] [--claude-arg <arg>] [--timeout <seconds>]
```

`explore start` records the exploration and starts a supervisor in the background. It returns at once with the exploration ID. Then run `explore wait <explorationId>`.

**The change.** `--since <git ref>` gives the base of the change, and `--until <git ref>` gives its end. `--until` needs `--since`. Checkmate runs git in the workspace, or in `--repo <dir>` when the code is in a subfolder. The diff uses the merge base, as a merge request does:

- With `--until`, the diff is `git diff <since>...<until>` (three dots): the changes of `<until>` since its merge base with `<since>`.
- Without `--until`, the end is the checked-out commit, and the diff is `git diff --merge-base <since>`: the changes from the merge base to the checked-out files, uncommitted changes included.

The changed files come from the same range (`git diff --name-only`). The study and the test brief both give the diff command and say: `Read the diff first. Test what the diff changes and what depends on it.` When `--until` is not the checked-out commit, the briefs also say that the checked-out files are the version before the change and that the diff shows the change. The exploration stores both refs in its charter. Without `--until`, it stores the short checked-out commit. `explore status` and `explore show` print them as `since` and `until`.

The supervisor does these steps:

1. It starts the explorers at the same time. Each explorer is a new Claude Code session in the workspace, with a pre-assigned session ID:

   ```sh
   claude -p <host arguments> --model <alias> --settings '{"enabledPlugins":{"<plugin id>":false}}' --session-id <id> --allowedTools <rule> ... --output-format json --permission-prompts none
   ```

   When the plan has an earlier exploration, Checkmate writes `.checkmate/work/<explorationId>/known-state.md` before the explorers start, and the brief tells them to read it and retest each open problem. The file does not name Checkmate. It asks for a retest of every listed defect, open and fixed, and for one line for each defect in the report: still present, fixed, or not retested with the reason. It has, in this order: the open defects of earlier builds with the build where they were last seen, the steps, and the expected and actual results; the answers of the product owner and the rejected claims; the defects reported as fixed, newest fix first, each with the build of the fix, the steps, and the expected and actual results; the areas tested before; and the criteria with no observation. It has at most 150 lines. When it is longer, Checkmate shortens the oldest fixed defects to a title line first, and says how many it shortened. The recorder gets the open defects of earlier builds of all explorers, and logs a `verdict` for each one that the session retested.

   When the plan has no rules, the supervisor first [derives them](#derived-rules).

   Each explorer session has two turns. Turn 1 (study) starts the session with `--session-id <id>`. Its brief has the goal, the requirements, the sources, the instructions, the changed files, the known-state file, the entry values of the instance, the allowed operations, and the tools. It tells the explorer to study the sources, the changed files, and the running application, to write `plan.md` with its test approach and `questions.md` with numbered questions for the owner of the product (or `None`), and not to test yet. Turn 2 (test) continues the same session with `--resume <id>`, the same model, the same `--settings` argument, and the same `--allowedTools` rules. Its brief tells the explorer to test the change and the existing behaviour that it can break, to use the sources where they decide a question, and to report the rest as unclear. It tells the explorer to use the existing records of the application, and to make new records when a case needs them, with a data prefix `qa-<explorationId>-<explorer>-`. It names the work folder `.checkmate/work/<explorationId>/<explorer>/` for the evidence files. It asks for `report.md` in that folder: one section for each defect (D1, D2, and so on) with title, severity, steps, expected result, actual result, and evidence files, then what the explorer tested and what is still unclear. When a known-state file exists, it asks for one line for each problem in it: still present, fixed, or not retested with the reason. Each turn states its time in seconds: `You have <n> seconds for this turn.` When turn 1 fails or times out, the explorer ends and turn 2 does not start. When turn 2 times out, the explorer ends as `interrupted`, and Checkmate records the session with the work so far. When turn 2 fails for another reason, Checkmate does not record the session. The study brief names the tools without an order, and asks for the fastest check that proves the behaviour: a direct HTTP call where it proves the point, the browser where the page itself is what is tested. It names the work folder of the explorer, and asks it to put each file that it or its tools make there. It says that, apart from the work folder, the folders in the workspace whose names start with a dot belong to tools, not to the product under test. The environment of each explorer sets `PLAYWRIGHT_MCP_OUTPUT_DIR` to the work folder and `PLAYWRIGHT_CLI_SESSION` to `qa-<explorationId>-<explorer>`, so the output of `playwright-cli` goes into the work folder, and each explorer has its own browser. The `--settings` argument of each explorer denies with permission rules: `Read` and `Edit` of `./.checkmate/checkmate.db*`, of `./.checkmate/tmp/**`, and of the work folders of the other explorers, and `cat` and `sqlite3` on the database. The verifier does not need a work folder: its rules deny `Read` and `Edit` of `./.checkmate/**`, and `ls`, `cat`, and `sqlite3` on `.checkmate`. A recorder does not get these rules.

   **Work folder.** The recorder resolves an evidence name in the work folder first, and saves each evidence file as a blob in the record. After the records, Checkmate saves `plan.md`, `questions.md`, `report.md`, and `follow-up-report.md` of each explorer as blobs, with the phase (`test`, or `follow-<n>`). `explore show` lists them as `file` lines, and its JSON has their text in `files`. When the exploration completes, Checkmate removes `.checkmate/work/<explorationId>/` and the log `.checkmate/tmp/explore-<explorationId>.log`. When it fails or stops, they stay, and `explore status` names the folder in `workFolder`. When an exploration starts, Checkmate stores whether `.playwright-cli` exists in the workspace root. When the exploration or a follow-up ends, and that folder did not exist at the start, Checkmate moves it into the work folder of the exploration, so it goes or stays with the work folder. A tester can make it with one browser command without its own session. Checkmate never touches a `.playwright-cli` folder that existed before. Checkmate does not touch a `qa-evidence` folder of an older version. The brief does not name Checkmate. The explorer does not run a Checkmate command.

2. When all explorers end, it records each explorer that completed, one after the other, as `record` does. The recorder gets the same `--model` and `--settings` as its explorer, and no `--allowedTools`.

**Clean context.** Checkmate reads the ID of its own plugin from `plugins/installed_plugins.json` in the Claude Code configuration directory (`CLAUDE_CONFIG_DIR`, else `~/.claude`). The `--settings` argument turns that plugin off for the session. So the skills of Checkmate are not in the context of the explorer, but the other skills of the host are. When Checkmate finds no install record, for example when the operator loads the plugin with `--plugin-dir`, it starts the session without `--settings`. This is normal: a session that does not load the plugin has nothing to turn off. The JSON of `explore status` has `pluginHidden: false`. Checkmate removes each `CHECKMATE_*` environment variable from the environment of an explorer.

**Permission hook.** When `.checkmate/ui.json` names a UI server that runs (its `pid` is alive), Checkmate adds two hooks to the `--settings` argument of each session that it starts for the exploration: the explorers, the recorders, the merger, the verifier, the rules clerk, and the follow-up turns. A `PermissionRequest` hook of type `http` posts the request to `http://127.0.0.1:<port>/hooks/permission/<explorationId>/<who>`, with a time-out of 600 seconds. A `PreToolUse` hook posts each tool call to `http://127.0.0.1:<port>/hooks/activity/<explorationId>/<who>`, with a time-out of 5 seconds. Both send the header `Authorization: Bearer $CHECKMATE_HOOK_TOKEN`. The variable `CHECKMATE_HOOK_TOKEN` is in the environment of that session only, and the hook lists it in `allowedEnvVars`. `<who>` is the name of the tester (`a1`), or the step: `record-<tester>`, `merge`, `verify`, or `rules`. Checkmate adds no tool list argument and changes no other argument. Without a live UI server, the arguments and the environment are the same as without this feature, and a tool that needs a permission is denied, as before. A managed setting that turns hooks off has the same result. Checkmate never makes a tester stricter or looser by itself: the hook only gives a person a way to say yes.

**Levels.** A test level sets the number of explorers, the model alias, whether a verifier runs, and the seconds of the study turn and of the test turn. `checkmate explore levels` prints the levels. The levels are:

- `smoke`: 1 explorer, no verifier.
- `normal`: 2 explorers and a verifier. This is the default level.
- `deep`: 3 explorers and a verifier.

`normal` and `deep` have the same model alias and the same seconds for each turn. An older store or target profile can have the old level `standard`. Checkmate reads it as `normal`. The order of choice is:

- Level: `--level`, else `explore.level` of the target profile, else `normal`.
- Number of explorers: `--explorers`, else `explore.explorers` of the profile, else the number of the level.
- Time of the turns: the study seconds of the level, and `--minutes <n>` times 60 for the test turn, else the test seconds of the level. `--minutes` does not change the study turn. Without `--timeout`, the deadline of each turn is three times the longer turn, and at least 1800 seconds.
- Model: `--claude-arg --model --claude-arg <model>`, else the alias of the level. Checkmate gives the alias as `--model <alias>`. The host resolves it.

**Host authentication.** When the output of an explorer, a recorder, the merger, or the verifier contains `authentication`, in any letter case, Checkmate stores a hint and does not try again. A Claude Code session does not pass its login token to the commands that it runs. Log in on the machine so that Claude Code stores the login, or run `checkmate test` from a shell outside a Claude Code session, or let the host give the credential in a supported way, for example an `apiKeyHelper` in the host settings. When no session could log in, the exploration fails with the reason `Host authentication: no session could log in.` Checkmate does not read or copy a credential.

When the host refuses the model, the launch of that explorer fails. `explore wait` gives a hint that names the override. Checkmate does not try another model.

**Permissions.** Give the tool rules of the explorers with `--allow`, one for each rule. Checkmate passes each one as `--allowedTools`. An explorer cannot answer a permission prompt. A tester can always write in its own work folder: Checkmate adds the rule `Edit(/.checkmate/work/<explorationId>/<explorer>/**)` to your rules for each turn of that tester, also for the follow-up turn. It adds no rule for the rest of `.checkmate/`, so the deny rules for the database stay in force. The `launch` event of the tester records the rule in `engineRules`. The rule is not one of your rules. Before and after each turn, Checkmate lists the top-level entries of the workspace that git does not track (the whole listing when the workspace is not a git repository), without `.checkmate` and `.playwright-cli`. An entry that is new after the turn is recorded as a `stray` event of the tester, and the Testers view says that the tester left files outside its work folder. Checkmate moves and deletes nothing. When testers run at the same time, a new entry can show for more than one tester. `--claude-arg` refuses `-p`, `--print`, `--output-format`, `--input-format`, `--json-schema`, `--plugin-dir`, `--settings`, `--resume`, `--fork-session`, `--session-id`, `--permission-prompts`, and the tool list arguments.

`--timeout` is the deadline of each explorer in seconds, a safety limit above the time budget. The supervisor writes its output to `.checkmate/tmp/explore-<explorationId>.log`. Checkmate removes the log when the exploration completes.

**Live activity.** While an explorer process runs, Checkmate reads its work folder every five seconds and at the end of each turn. When a file is new or changed, it stores one activity line, for example `test: wrote report.md. 2 files in the work folder.` The live view shows the latest line. Checkmate does not read the output of the session while it runs: with `--output-format json`, the session prints its result only at the end.

### explore status and explore wait

`explore status <explorationId>` prints the state, the level, the number of explorers, the model and where it came from (`level` or `host`), the verifier choice, the refs of the change (`since`, `until`), the seconds of the study turn and of the test turn (`studySeconds`, `testSeconds`), and one line for each explorer: its session, its end, its record, and the number of saved entries. When a launch failed, one `stderr` line follows for each of the last 10 lines of the error output, also in `explore show`.

| State         | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `open`        | The exploration has no explorers. Record sessions with `record`.    |
| `starting`    | The supervisor did not start yet.                                   |
| `testing`     | The explorers run.                                                  |
| `recording`   | The recorders run.                                                  |
| `verifying`   | The merger and the verifier run.                                    |
| `following`   | A follow-up runs.                                                   |
| `completed`   | One or more sessions were recorded.                                 |
| `failed`      | No session was recorded, or a step failed.                          |
| `stopped`     | A person stopped the exploration with `explore stop`.               |
| `interrupted` | The supervisor process ended before the end, and nobody stopped it. |

`reason` of a stopped exploration is `Stopped by <actor>: <reason>`. `reason` of an interrupted exploration is `The supervisor stopped before the end.`

A follow-up does not change the state of a completed exploration. `follow` gives its result: `running`, `completed`, `failed`, `stopped`, or `interrupted`, and `followReason` gives the reason of a failed, stopped, or interrupted follow-up. While a follow-up fails, stops, or is interrupted, `workFolder` names the folder that stays. `explore status` and `explore show` print one phase line for each `follow` (with `answers=<n>`) and `followed` event, with the reason and the skipped sessions.

`explore wait <explorationId> [--timeout <seconds>]` waits until the state is `completed`, `failed`, `stopped`, `interrupted`, or `open`, or until the timeout. The default timeout is 3600 seconds. The JSON has `outcome`:

| `outcome` | Status              | Exit |
| --------- | ------------------- | ---- |
| `done`    | `completed`         | 0    |
| `failed`  | `operational_error` | 1    |
| `timeout` | `interrupted`       | 1    |

An operator agent runs `explore wait` as a background command. A factory runs it directly.

### Merge, verify, and claims

After the records, the supervisor does two more steps:

1. **Merge.** When two or more explorers reported defects on the build, a merger gets the defect reports and a list of reports with many of the same words. The merger is a new Claude Code session with the model of the level and no tool rules. It replies with `issue` entries: one for each defect that two or more reports describe. Checkmate logs them as `qa:merge`, and repairs refused entries once.
   Then each defect of the build that is in no issue, and that has some of the same words or steps as another report or an issue, goes to one more short round of the merger. When the build has earlier claims, the merger gets them too, each issue with its reports. When the merger sends a new issue that names an issue of the merger or one of its reports, Checkmate joins it to that issue: the issue keeps its ID and gets the new reports. So a defect of a follow-up joins the claim of another explorer, and no second claim opens. A report of a later build that describes an earlier claim joins that claim as a new report. The status of the claim on that build is `not_fixed`, with the basis `reported`.
2. **Verify.** When the level has a verifier, a verifier gets each claim of the build with one reporter and no verification. It is a new Claude Code session in a clean context, with the tool rules of the explorers. Its brief has the steps, the expected result, and the reported result of each claim, and does not name Checkmate. It replies with one result for each claim: seen or not seen, and what it saw. Checkmate logs an observation as `qa:verify` that confirms or refutes the claim. When the reply has no usable JSON array, Checkmate resumes the verifier once and asks for the array again. When there is still no usable reply, the verify step is `skipped` with the reason, the claims keep their states, and the exploration completes. `skipped` is information, not an error.

A claim is an issue of the merger, or a defect that is in no issue. Its ID is `<explorer>/<entryId>`, for example `a1/D1`, or `merge/I1`. A claim has one state:

| State        | When                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `observed`   | One explorer reported it with steps or evidence.                                                     |
| `suspected`  | Each report is marked `suspected`, or has no steps and no evidence.                                  |
| `confirmed`  | Two or more explorers reported it, or the verifier saw it again.                                     |
| `unresolved` | The verifier did not see it. The reason gives what the verifier saw. The claim stays in the record.  |
| `accepted`   | The oracle accepted it as a defect: `checkmate claim accept <planId> <claimId> --rationale "<why>"`. |
| `rejected`   | The oracle rejected it: `checkmate claim reject <planId> <claimId> --rationale "<why>"`.             |

A claim needs no planned assertion. The factory works on the open claims that are `observed`, `confirmed`, or `accepted`. The inbox lists the open claims that are `suspected` or `unresolved`. A claim is closed when the oracle rejects it, or when the latest retest verdict of a later build is `fixed`.

**Questions.** The merger also joins the questions that one answer answers into a `topic` entry, for example `merge/T1`, with its members and a `label` of one to three words. The inbox, `status`, `explore show`, and the review UI show the topic in place of its members, and one answer to the topic answers each member. The record keeps each question of each explorer. A question is non-blocking unless the explorer marked it `blocking`. Only a blocking question, or a `suspected` or `unresolved` claim, makes the plan wait on the oracle. A question is in the same inbox list as the gaps of the plans, with its ID, for example `a1/Q1` or `merge/T1`. Answer it as a gap: `checkmate gap answer <planId> a1/Q1 --kind <kind> --value "<answer>" --rationale "<why>"`. The answer goes into the record. The next recorders of the plan see it.

### Hand-over

`checkmate claim handoff <planId> <claimId...> --to "<who or what>"` records that the claims went to a developer, a team, or a ticket. Checkmate stores the actor, the time, and the target for each claim. It refuses an unknown claim and a rejected claim. `checkmate claim handoff <planId> <claimId...> --undo` removes the hand-over. The record keeps both rows.

`claim list` and `explore show` print `handed=<target>` for a claim that is handed over, and the JSON has `handoff` with `to`, `actor`, and `at`. After an exploration, while open claims of the factory are not handed over, `status` prints the `next` line `<n> defects are not handed over: checkmate claim handoff <planId> <claimId...> --to "<who or what>"`.

### explore follow

```sh
checkmate explore follow <explorationId> [--allow <rule>] [--claude-arg <arg>] [--timeout <seconds>]
```

`explore follow` tests the answers of the oracle. It does not wait for answers before the test: the explorers test first, and the follow-up tests the points that the answers decide.

It needs a completed exploration, and one or more questions of the exploration with an answer that no completed follow-up used. Else it refuses with the reason and a hint. It returns at once. Then run `explore wait <explorationId>`.

1. It resumes each explorer session of the exploration for one more turn, with `--resume <session>`, the model, the `--settings` argument, and the `--allowedTools` rules of the earlier turns, and no tool list argument. Without `--allow`, `--claude-arg`, or `--timeout`, it uses the values of `explore start`. It skips a session that ended in its study turn, and a session that it cannot resume, and gives the reason of each.
2. The brief of the turn does not name Checkmate. It gives the answered questions with their answers, numbered, the same list to each explorer: `The owner of the product answered these questions:`. It asks the explorer to test the points that the answers decide, on the same build, and to add to `report.md` each new defect and one line for each earlier unclear point that an answer settles. It gives the seconds of the follow-up turn of the level: smoke 300, normal 600, deep 600.
3. The recorder runs again on each session that ended or timed out. Its prompt lists the entries of the explorer that the record holds, and asks only for the entries that are not in that list. Checkmate also drops each reply entry with the same kind and title (or text) as an entry of the list. The record event gives the count as `repeated`.
4. The merge and the verify run for the new defects only. The merger gets the earlier claims of the build too, so a new defect that describes an earlier claim joins it.
5. When one or more sessions are recorded, the follow-up is `completed`, and its answers are used. When the follow-up fails or stops, the exploration stays `completed` with its claims, its answers stay unused, and you can run it again.

After an answer to a question of a completed exploration, the first `next` line of `status` is `<n> unused answers of <explorationId>: checkmate explore follow <explorationId>`.

### Session path

The session path is the default of the test skill in Claude Code. Checkmate keeps the state. The operator agent only carries out the actions. The plugin has two agents in `agents/`: `tester` (tools `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`) and `clerk` (tools `Read`, `Write`). Their text does not name Checkmate, and they get no skills. The model is in the front matter of each agent. The level sets the number of testers and the verifier. To use another model, the operator gives it as the `model` parameter of the Agent tool.

When the operator needs a choice from the person, for example the environment of a URL that is not local, the skills tell it to ask with the `AskUserQuestion` tool of the host: one call, at most 4 questions, 2 to 4 options each, the recommended option first. A subagent and a run without a person do not have that tool, and a task from an agent, a factory, or a script must not use it. Then the operator writes the question and its options as a numbered list in its reply, or returns `needs_decision`. The CLI does not ask questions.

`checkmate explore next <explorationId>` prints the actions that are due now, one on each line, and in `actions` of the JSON:

| Action                                                                                                      | The operator                                                                     |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `start <name> <step> agent=checkmate:<agent> description="<explorationId> <name> <step>" prompt="<prompt>"` | Starts a new agent with the Agent tool, with this type, description, and prompt. |
| `message <name> <step> agent=<agent id> prompt="<prompt>"`                                                  | Sends the prompt to the agent with this ID with the SendMessage tool.            |
| `wait`                                                                                                      | Waits: one or more agents run.                                                   |
| `finished`                                                                                                  | Reports. Line 1 is `operational_error` when the exploration failed.              |

The prompt is always one sentence: `Read <task file> and do what it says.`, or for the clerk, `Read <task file> and write your answer to <answer file>.` Checkmate writes each task file in the work folder before it prints the action. Each task file asks for a reply of three lines at most: what the agent did, the most important finding or blocker, and the number of questions or defects. The details stay in the files. Then it ends with one instruction: end your reply with the line `tester <explorer> <step> done`, or `rules done`, `merge done`, or `verify done`. The description of the agent and this line name the tester, so the operator can pair each result with its tester when several results arrive together. A task file has the same brief as the process path. The study task adds one line: start each shell command with `export PLAYWRIGHT_CLI_SESSION=qa-<explorationId>-<explorer>;`, so that each tester has its own browser. The steps are, in this order:

1. `rules` with the clerk, only when the plan has no rules. Read [Derived rules](#derived-rules). The answer file is `.checkmate/work/<explorationId>/rules/answer.json`. When Checkmate refuses the rules, the next action is one `message` with `task-repair.md`. The testers start when this step ends.
2. `study`, `test`, and `record` for each tester (`a1`, `a2`, ...). The record task is the recorder prompt, with one change: the tester writes the JSON array to `<work folder>/entries.json`. Checkmate checks the file as `record` does: new IDs, evidence files to blobs, and dropped references. When it refuses an entry, the next action is one `message` with `task-repair.md`. There is one repair round.
3. `merge` with the clerk, when the merge of the process path applies. The answer file is `.checkmate/work/<explorationId>/merge/answer.json`. Checkmate repairs refused entries once and gives the extra round for reports in no issue, as in the process path.
4. `verify` with a tester, when the level has a verifier and a claim has one reporter. When the answer file has no usable array, there is one repair round. Then the step is `skipped`.
5. `finished`. Checkmate saves `plan.md`, `questions.md`, `report.md`, and `follow-up-report.md` of each tester, and removes the work folder of a completed exploration. When `.checkmate/work` and `.checkmate/tmp` are then empty, it removes them too.

`checkmate explore done <explorationId> <name> <step> [--agent <agent id>] [--failed "<reason>"] [--activity "<text>"]` records that a step ended. `<name>` is a tester, `rules`, `merge`, or `verify`. `<step>` is `study`, `test`, `record`, `follow`, `rules`, `merge`, or `verify`. Give `--agent` with the ID that the Agent tool returned, at least the first time. Checkmate stores it and uses it in each later `message` action. `--failed` ends that tester or step. `--activity` is one line of what the agent did. `--reply-line` is the last line of the reply. When it names another tester or step, `done` refuses and the hint gives the command for that tester. `done` refuses an agent ID that is bound to another tester, and the hint names that tester and the command that corrects it. To correct the agent ID of a tester, run `done` again for its last step with the right `--agent`, while its next step has not started. `explore status` prints `agent=<agent id>` for each tester. The live view of the review UI shows the last one. Without it, Checkmate stores `<step> ended`. `done` refuses a step that does not run.

Checkmate does not know when an agent starts. An action that `next` printed is `given` (given to the session). The `hint:` line of `next` gives `checkmate explore started <explorationId> <names...>`. The operator runs it once, in the message that sends the actions, and the steps of those names become `running`. `done` makes a step `ended`, or `failed` with `--failed`. The live view shows for each tester the step, its state, the time in that state, and the activity of the last ended step with the name of that step.

`checkmate explore pause <explorationId> --reason "<one line>"` records that the operator stopped the loop to wait for the person. The next `next`, `started`, or `done` clears it. While it is set, `explore status` prints a `paused` line, `status` gives `waitsOn=oracle` with the reason, and the live view and the plan page show `Paused: <reason>`.

`explore follow` on an exploration of the session path gives one `message` action for each tester with an agent, with the follow-up brief in `task-follow.md`. The same task asks the tester to write only the new entries of the turn to `entries.json`, in the form of its earlier entries file. The tester already has the entry form in its context, so there is no separate `record` message. `explore done <explorationId> <explorer> follow` reads the file with the checks of `record`. When it refuses an entry, the next action is one `message` with `task-repair.md`, and the step of that message is `record`. Then the merge and the verify run for the new items only, as above. When the operator reports that an agent cannot be reached (`--failed`), Checkmate skips that tester. When no tester can be reached, the follow-up fails with this hint: the testers ran in a session that ended. Run `checkmate test <planId> --build <build> --session` again. The answers reach the new testers through the known-state file.

The exploration stores its path. `explore status`, `explore show`, and `explore wait` work for both paths. `explore status` prints `path=session` for the session path. On the session path the state goes from `testing` to `recording`, `verifying`, and `completed` or `failed`. It has no supervisor, so it does not become `starting`, `stopped`, or `interrupted`.

### explore stop

`checkmate explore stop <explorationId> [--explorer <name>] [--reason <text>]` stops an exploration that is `starting`, `testing`, `recording`, `verifying`, or `following`. It also stops an `interrupted` exploration, to end the tester processes that stay.

Without `--explorer`, the command does these steps:

1. It records a `stop` event with the actor, the reason, and the state that the exploration had.
2. It ends the supervisor and each `claude` process that the supervisor started. It waits up to 7 seconds for the supervisor, and up to 7 seconds for the other processes. When a process is still alive, `status` is `operational_error` and `left` lists the process IDs.
3. It keeps everything that is recorded. It does not delete the work folder. `workFolder` and `note` in the reply tell you that reports that were not recorded stay in the folder.

The state is then `stopped`. A stopped exploration stays in the record. `checkmate test <planId> --build <build>` and `explore start` start a new exploration for the same build.

With `--explorer <name>`, the command ends only the `claude` process of that tester. The other testers go on. The run records, merges, and checks what exists. The tester shows `operational_error` when the run ends.

The command refuses in these cases:

- The exploration does not exist.
- The exploration is `open`, `completed`, `failed`, or `stopped`.
- The exploration is on the session path. The operator session owns the testers. Stop them in the session.
- The tester does not exist, has ended, or stopped already.

A stop and the end of the run can happen together. The event that Checkmate records first wins. When the run ended first, the stop is refused. When the stop is first, the supervisor writes no `done` event.

The supervisor ends its own `claude` processes when it gets `SIGTERM` or `SIGINT`. When `SIGKILL` ends the supervisor, the state is `interrupted`, and the `claude` processes can stay alive until `explore stop` ends them.

### explore permit

`checkmate explore permit <explorationId> <requestId> --allow` answers a permission request of a tester. Give exactly one of these options:

| Option         | Answer                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--allow`      | Allows the call once.                                                                                                                             |
| `--allow-kind` | Allows the call and the rule that Claude Code suggests for it, for the rest of the test. Checkmate records the rule on the exploration.           |
| `--always`     | Allows the call and the same rule in the local settings of the project. Claude Code writes its own settings file. Checkmate writes no file.       |
| `--deny`       | Denies the call. `--reason <text>` is required. The tester gets the text as the reason.                                                           |
| `--stop`       | Denies the call, ends the session of the tester, and stops the tester as `explore stop --explorer` does. For a step of the run, it stops the run. |

`--allow-kind` and `--always` need a request with a suggestion of type `addRules`. A request that has an answer already, or that is closed, refuses a second answer. The command needs a running UI for the folder (`checkmate ui`): the UI holds the answer of the tester until a person decides. Without it, the command refuses and changes nothing. The UI reads the answer from the record and gives it to the tester within a second.

A later request of the same exploration is answered at once when its first `addRules` suggestion has the same rules as a rule that `--allow-kind` set. This holds for each tester and each step of the run. The record shows it as `allowed by rule <rule>, set by <actor>`.

`explore permissions <explorationId>` prints one line for each request: the ID, the answer or `open`, who asked, the tool, the first line of the input, and the rule. Read [Permission requests](review-ui.md#permission-requests) for the way the UI shows them.

### explore finish

`checkmate explore finish <explorationId> [--level <level>] [--allow <rule>] [--claude-arg <arg>]` is for an exploration without explorers, after `record` of each session. It starts the supervisor for the merge and the verify steps. It needs `--allow` when the level has a verifier.

### harvest

`checkmate harvest <explorationId> [--observations]` makes stored test definitions from what the explorers did. The check path then runs them again on each later build.

- Each claim of the exploration that is `observed`, `confirmed`, or `accepted` gives one test. Its action is the steps of the best report. Its assertion is the `expected` of the claim, as an `agent_observation`. A `suspected`, `unresolved`, or `rejected` claim gives no test.
- With `--observations`, each observation with `verdict: ok` and steps gives one test too. With a `value`, the check is `The result is <value>.` and `deterministic`. The expected value of such a test comes from the running application, not from a source. Its metadata has `"basis": "observed"`, so that the oracle can review it.
- A test gets the requirement of the criterion that its report links to, with the source of the criterion. Else it gets a new requirement from the expected result, with the source `exploration:<explorationId>/<claimId>`. New requirement IDs are `HR1`, `HR2`, and so on. Test IDs are `H1`, `H2`, and so on.
- Each test has `"type": "regression"`, `"origin": "harvest"`, `"harvestedFrom": "<explorationId>/<id>"`, and the build in its metadata. The capability is `browser` for a report `via: ui`, `http` for `via: api`, else the first capability of the target. The operations are the allowed operations of the target.
- When the plan has no revision, `harvest` saves revision 1 with only the harvested requirements and tests. Else it edits the latest revision as `plan edit` does: in place, or a new revision when the latest revision is approved or used by a run.
- An item that the plan has already is not harvested again. When no item is new, `harvest` refuses.

### record

```sh
checkmate record <explorationId> --explorer <name> --session <sessionId> [--timeout <seconds>] [--claude-arg <arg>]
```

`record` writes the record of one Claude Code test session. Use it for a session that Checkmate did not start too, for example the session of a person or of a factory tester. Run it in the directory where the test session ran.

1. It refuses an unknown exploration, an explorer name `rules`, `merge`, or `verify`, a session ID that is not a UUID, a `PATH` without `claude`, and a call inside a recorder (`CHECKMATE_RECORDER` is set).
2. It starts one recorder, in print mode, and waits for it to end:

   ```sh
   claude -p --resume <sessionId> --fork-session --session-id <recorderId> --output-format json --permission-prompts none
   ```

   The recorder is a copy of the test session. The test session does not see it. Checkmate gives the recorder no tool and no tool list, so the copy uses the prompt cache of the test session. When Checkmate started the test session, the recorder gets the same session arguments as that session, for example the same model. Else it gets the `--claude-arg` arguments of `record`.

3. The prompt has the task, the entry kinds and their fields, an example, the rules of the charter as `<id>: <text>`, and what the record already holds for the explorer. It asks for one `criterion` entry for each rule that the session checked, with the `rule` and a `verdict` (`ok` or `wrong`), and for the `rule` of each defect and question, or `outside`. The recorder replies with one JSON array of entries.
4. Checkmate logs the entries as the actor `qa:<explorer>`, with the build of the exploration. It saves each valid entry and refuses each invalid entry alone. A reply entry with an ID that the record has gets a free ID. An evidence path that does not exist is searched below the current directory. When one file matches, Checkmate stores it. Else the path stays as text, and `missingEvidence` lists it. A link to an unknown ID is left out, and `droppedReferences` lists it. A `rule` that is not a rule of the charter becomes `outside`, and `unknownRules` lists it. Checkmate does not refuse the entry for it.
5. When it refuses entries, it resumes the recorder one time with the refusals. There is no second repair.

Two `record` calls for one explorer of one plan do not run at the same time. `--timeout` is in seconds for all recorder calls together. The default is 600.

| Status              | When                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `completed`         | Checkmate saved one or more entries.                                     |
| `operational_error` | The recorder failed, the reply has no JSON array, or no entry was saved. |
| `interrupted`       | The recorder did not end before `--timeout`.                             |
| `rejected`          | A refusal before the start. No recorder started.                         |

### explore log

`checkmate explore log <explorationId> --actor <actor>` saves entries from standard input, as the recorder does, but strictly: an evidence path must exist, and a link must name a known entry. The input can be one entry, an array, or JSON in a code fence. Trailing commas are accepted.

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

| Flag               | Values                                      | Default                                                                                       |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `--tests`          | A list of test IDs.                         | Without it, `ready_only` selects the ready tests. With `wait_for_resolution`, it is required. |
| `--build`          | The application build identity.             | Required.                                                                                     |
| `--instance`       | An active instance of the target.           | The only active instance of the target.                                                       |
| `--partial`        | `wait_for_resolution`, `ready_only`         | `ready_only`                                                                                  |
| `--on-new-blocker` | `continue_independent`, `return_to_oracle`  | `continue_independent`                                                                        |
| `--timeout`        | 1 to 3600 seconds. The run deadline.        | 600                                                                                           |
| `--retest-of`      | A finished run of the same plan and target. | None.                                                                                         |

- `ready_only` permits a selection of ready tests. Without `--tests`, Checkmate selects the ready tests and prints `<testId> left_out <reason>` for each other test. It leaves out a test that an open blocking gap of a run affects. When no test is ready, the gate refuses the run.
- `--on-new-blocker` tells QA what to do after it records a new blocking gap. `continue_independent` is the default. QA closes the tests that the gap affects as `blocked` and continues the other tests. `return_to_oracle` stops all further actions and closes the remaining tests as `blocked`. Use it when one gap can make all other results wrong, for example a wrong build. Checkmate records the policy. The agent applies it.
- A retest needs a new run ID and a new build. `run begin` records the open defects of the earlier run in the request as `retestDefects`.
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

**Deadlines.** `--timeout` sets the deadline in seconds, from 1 to 3600. Another value gives `invalid_request`. Setup, plan, and revise use 300 seconds by default. Execute uses the seconds that remain of the run deadline, at least 1. The execute prompt gives the run deadline in UTC and the remaining seconds. It has no second deadline. The other prompts give the deadline in UTC and tell the worker to check the time with `date -u`. The launcher stops the worker's process group at the deadline, on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

**Lock.** When the parent cannot get the database lock before it starts the worker, `delegate` gives `operational_error` with the reason to run the command again. When it cannot get the lock after the worker, the worker can have written already. Then the reason tells you to read `checkmate status` or `checkmate log` before you run `delegate` again.

**After execute.** When the target profile has a `playwright-cli` tool, the parent closes the run's browser session with `playwright-cli -s=<browserSession> close`. For another target, it runs no close command. When the worker stops before `run finish`, the run stays `started` and its results stay. The response is `interrupted` or `operational_error`, and its reason names `run resume` and `run finish`.

**Platforms.** Linux is tested. The launcher refuses Windows.

## ui

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

Prints `completed ui url=<url>` and serves the review UI on `127.0.0.1` until SIGINT or SIGTERM. The default port is a free port. The UI writes only when a human submits a form. The Settings button in the top bar opens Settings, with the targets and their instances and the tool rules of the testers. The UI can set up a target and start the first test of a new change: it calls the functions of `setup` and `test`. Read [Review in the browser](../guides/review-ui.md).

## Environment variables

| Variable                    | Read by        | Effect                                                                                                                            |
| --------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CHECKMATE_ACTOR`           | Checkmate      | The default actor of a write. `--actor` overrides it.                                                                             |
| `CHECKMATE_BUSY_TIMEOUT_MS` | Checkmate      | The wait for the database lock in milliseconds. A value that is not a whole number from 1 to 2147483647 gives the default, 30000. |
| `ANTHROPIC_MODEL`           | The host       | Claude Code selects the model with it. Checkmate does not read it. `delegate` passes it.                                          |
| `PLAYWRIGHT_MCP_OUTPUT_DIR` | Playwright CLI | `delegate execute` sets it to `.checkmate/tmp/<runId>`, and an explorer gets its work folder, so browser output stays there.      |

The tests read more variables. Read [Development](../development.md).

## Next

- [Payloads](payloads.md): the JSON for each command.
- [Runs and evidence](runs.md): the run commands in detail.
