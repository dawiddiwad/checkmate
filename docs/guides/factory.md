# Run Checkmate from a factory

> **Guide** · For agents, factories, CI jobs, and scripts that use the npm CLI. This is team mode.

The factory opens each subject with a command and gives each stage to a Claude Code worker with `checkmate delegate`. The oracle decides between the stages, and the factory reads the record to know what to do next.

<img src="../img/life.png" alt="Diagram: one plan from ticket to accepted result. On the left, the loop states with the role that each one waits on: needs_plan waits on the planner, needs_answers on the oracle, needs_revision on the planner, needs_approval on the oracle, ready_to_run on QA, defects_open on the factory, awaits_acceptance on the oracle, and accepted on none. On the right, the next step for each state: the planner writes plan@1 with gap G1 (plan save), the oracle answers G1 (gap answer), the planner writes plan@2 (plan revise), the oracle approves plan@2 (plan approve), QA runs the tests on build b1 (run begin), the factory fixes the code and builds b2, QA retests on build b2 (--retest-of), and the oracle accepts the result (result accept). An amber arrow goes from the runs back to the oracle's answer: a run finds a new gap. checkmate status prints the state, and the review UI shows it too." width="100%"/>

**On this page:** [Before you start](#before-you-start) · [Read a response](#read-a-response) · [Give permissions to a worker](#give-permissions-to-a-worker) · [One ticket through the loop](#one-ticket-through-the-loop) · [Read the record](#read-the-record) · [When a run stops](#when-a-run-stops) · [Use a sub-agent instead of delegate](#use-a-sub-agent-instead-of-delegate)

## Before you start

- The CLI: `npm i -g @xoxoai/checkmate`. It contains the plugin and adds `delegate`.
- Node.js 24.12.0 or later.
- Claude Code with a logged-in `claude` command. `delegate` starts it.
- For browser tests, Playwright CLI: `npm i -g @playwright/cli`.

Run every command in the application workspace, or add `--workspace <path>`. The record is `.checkmate/checkmate.db` in that workspace.

## Read a response

Line 1 of each response is `<status> <subject>` with short `key=value` facts. `reason:` lines follow.

```text
needs_decision checkout@1 sha256=1a44947e
reason: G1: Does the promotion stack with the loyalty discount?
```

`completed` and `needs_decision` exit with 0. `needs_decision` is a correct result: the oracle must decide or give input. Read line 1, not only the exit code. [Commands](../reference/commands.md#statuses-and-exit-codes) lists every status.

## Give permissions to a worker

Give each delegated stage at least `--allow Read --allow Bash`. The worker cannot answer permission prompts.

A prefix rule such as `Bash(node *)` is not sufficient. The worker sends JSON to Checkmate in a heredoc, and the permission check of Claude Code blocks that heredoc under a prefix rule. Add a rule for each tool that the stage needs, for example `--allow mcp__jira` for every tool of the `jira` MCP server. The host owns the permissions.

## One ticket through the loop

### 1. Set up the target

Set up the target once. Name the tools that the stages can use with `--tool <name>:<cli|mcp|skill>:<purpose>`. When no tool is named for a capability, the setup stage adds `playwright-cli` for `browser` and `node` for `http`.

```sh
checkmate target open shop --base-url "$BASE_URL" --capabilities browser,http \
  --operations read_catalog,create_order \
  --tool "playwright-cli:cli:Drive the browser." --tool "jira:mcp:Read the ticket."
checkmate delegate setup shop --allow Read --allow Bash
```

### 2. Iteration 1: plan and run early

The planner writes the tests from the ticket. The feature does not exist yet, so the plan has gaps. The response is `needs_decision` with one `reason:` line for each open blocking gap.

```sh
checkmate plan open checkout --target shop@1 --objective "Verify checkout totals." \
  --source jira:SHOP-12 --instructions "Use the acceptance criteria only."
checkmate delegate plan checkout --allow Read --allow Bash --allow mcp__jira
```

The oracle approves the revision, and QA runs the ready tests early. Most tests fail, and this is correct: an early run explores the requirements. Each failed assertion gets a defect with evidence. Unclear behavior becomes a new gap of the run.

```sh
checkmate plan approve checkout@1 --rationale "Run the ready tests early."
checkmate run begin run-1 checkout@1 --build "$GIT_SHA" --partial ready_only
checkmate delegate execute run-1 --allow Read --allow Bash
```

Without `--tests`, `--partial ready_only` selects the ready tests. It prints one line for each test that it leaves out:

```text
completed run-1 tests=T1 startedAt=... browserSession=... deadlineSeconds=600 evidenceDirectory=.checkmate/tmp/run-1/
T2	left_out	blocked by G1
```

When `run begin` prints `needs_decision`, the gate refused the run, and no run exists. The `reason:` lines name the missing approval, the open gaps, or the blocked tests.

### 3. Iteration 2: answer, revise, fix, and retest

The oracle answers the gaps, also the gaps that the run found. The planner applies the answers in a new revision, and the oracle approves it.

```sh
checkmate status checkout    # state=needs_answers waitsOn=oracle
checkmate gap answer checkout G1 --kind clarify --source docs/promo.md \
  --value "The promotion replaces the loyalty discount." --rationale "Product decision."
checkmate gap answer checkout G4 --kind defer --value "Not in this release." --rationale "Product decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate status checkout    # names the revision to approve
checkmate plan approve checkout@3 --rationale "Tests match the answers."
```

G4 came from the run, so `gap answer` first added it to the plan as `checkout@2`. Revise then wrote `checkout@3`. Always approve the revision that `status` names.

The factory reads the findings, fixes the code, and makes a new build. QA retests on that build with a new run ID and `--retest-of`. The earlier run does not change.

```sh
checkmate status checkout    # state=defects_open waitsOn=factory
checkmate export run run-1 --format md
checkmate run begin run-2 checkout@3 --tests T1,T2,T3,T4 --build "$NEW_SHA" --retest-of run-1
checkmate delegate execute run-2 --allow Read --allow Bash
```

A narrow retest, with fewer tests, keeps the requirements of the other tests uncovered.

### 4. Accept

When the retest passes, the oracle accepts the result. Otherwise the factory fixes the code, and QA retests again. Only the latest run of a retest chain waits for acceptance.

```sh
checkmate result accept run-2 --rationale "All tests pass on the new build."
checkmate export run run-2 --format html --out reports/run-2.html
```

[Decide as the oracle](oracle.md) has every kind of decision.

## Read the record

| Question                                | Command                                      |
| --------------------------------------- | -------------------------------------------- |
| Where is this ticket? Who acts next?    | `checkmate status <planId>`                  |
| What waits for the oracle?              | `checkmate inbox`                            |
| Which tickets wait for the factory?     | `checkmate plan list --waits-on factory`     |
| What did a run record?                  | `checkmate run show <runId>`                 |
| What changed, and who changed it?       | `checkmate log --subject plan:<planId>`      |
| The full record of a run, for a program | `checkmate export run <runId> --format json` |
| Anything else                           | `checkmate query "<sql>"` (read-only)        |

`status` prints the loop state, the role that it waits on, and the next command:

```text
completed checkout state=needs_answers waitsOn=oracle revision=1 approval=approved run=run-1
why	1 open blocking gap
next	checkmate gap answer checkout <gapId> --kind <kind> --value "<answer>" --rationale "<why>"
G1	gap	blocking	Does the promotion stack with the loyalty discount?
F1	defect	run-1	medium	T1.A1	Wrong total
```

`delegate` does not trust the summary of the worker. It reads the database and returns the response of the recorded command. [Loop states](../reference/commands.md#loop-states) lists every state.

## When a run stops

A deadline, a signal, or a crash does not finish a run. The run stays `started`, and the recorded results stay. `delegate` returns `interrupted` or `operational_error`.

- `checkmate run resume <runId>` lists each test that is not closed, with its assertions that have no result. Then delegate `execute` again.
- Checkmate does not repeat a test. Each open test shows `Actions may have occurred`, and the oracle decides to continue it or to close it as `error`.
- `checkmate run resume <runId> --error T3,T4 --reason <text>` closes the named tests as `error`.
- `checkmate run finish <runId> ...` ends the run with the results that it has.

[Resume](../reference/runs.md#resume) has the rules.

## Use a sub-agent instead of delegate

A parent agent in Claude Code can give a stage to a sub-agent that has the Checkmate plugin.

1. Prepare the subject as for `delegate`: `target open`, `plan open`, `gap answer`, or `run begin`.
2. Give the sub-agent the stage and the subject, for example: "Delegated Checkmate plan stage for plan `checkout`. Use the checkmate:plan skill." For execute, give the run ID.
3. The sub-agent does not ask the oracle. It returns `{ status, subject, reasons }`.
4. Check the result in the record with `inbox`, `plan show`, or `run show`. Do not trust the returned words alone.

## Next

- [Decide as the oracle](oracle.md): gaps, plan edits, approvals, and results.
- [Commands](../reference/commands.md): every command and `delegate` in detail.
- [Runs and evidence](../reference/runs.md): outcomes, evidence, and coverage.
