# Run Checkmate from a factory

> **Guide** · For agents, factories, CI jobs, and scripts that use the npm CLI. This is team mode.

The factory opens each subject with a command and gives each stage to a Claude Code worker with `checkmate delegate`. The oracle reads the inbox and decides, and the factory reads the record to know what to do next.

## Before you start

- The CLI: `npm i -g @xoxoai/checkmate`. It contains the plugin and adds `delegate`.
- Node.js 24.12.0 or later.
- Claude Code with a logged-in `claude` command. `delegate` starts it.
- For browser tests, Playwright CLI: `npm i -g @playwright/cli`.

Run every command in the application workspace, or add `--workspace <path>`.

## Read a response

Line 1 of each response is `<status> <subject>` with short `key=value` facts. `reason:` lines follow.

```text
needs_decision checkout@1 sha256=1a44947e
reason: G1: Does the promotion stack with the loyalty discount?
```

`completed` and `needs_decision` exit with 0. `needs_decision` is a correct result: the oracle must decide or give input. Read line 1, not only the exit code. [Commands](../reference/commands.md#statuses-and-exit-codes) lists every status.

## Give permissions to a worker

Give each delegated stage at least `--allow Read --allow Bash`. The worker cannot answer permission prompts.

A prefix rule such as `Bash(node *)` is not sufficient. The permission check of Claude Code blocks the heredoc that sends a JSON payload. Add a rule for each tool that the stage needs, for example `--allow mcp__jira` for every tool of the `jira` MCP server. The host owns the permissions.

## Steps

### 1. Set up the target

Name the tools with `--tool <name>:<cli|mcp|skill>:<purpose>`. When no tool is named for a capability, the setup stage adds `playwright-cli` for `browser` and `node` for `http`.

```sh
checkmate target open shop --base-url "$BASE_URL" --capabilities browser,http \
  --operations read_catalog,create_order \
  --tool "playwright-cli:cli:Drive the browser." --tool "jira:mcp:Read the ticket."
checkmate delegate setup shop --allow Read --allow Bash
```

### 2. Plan

Open the plan with its sources, then give the plan stage to a worker. Allow the tools that read the sources.

```sh
checkmate plan open checkout --target shop@1 --objective "Verify checkout totals." \
  --source jira:SHOP-12 --instructions "Use the acceptance criteria only."
checkmate delegate plan checkout --allow Read --allow Bash --allow mcp__jira
```

A plan with gaps gives `needs_decision` with one `reason:` line for each open blocking gap. To give the requirements yourself, send the request as JSON on standard input. Read [Plan request](../reference/payloads.md#plan-request).

### 3. Decide

The oracle reads the inbox, answers the gaps, and approves the new revision.

```sh
checkmate inbox
checkmate gap answer checkout G1 --kind clarify --source decisions#promotion \
  --value "The promotion replaces the loyalty discount. The total is 240 PLN." \
  --rationale "Product owner decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate plan approve checkout@2 --rationale "Tests match the answers."
```

[Decide as the oracle](oracle.md) has every kind of decision.

### 4. Execute

Begin the run, then give the execute stage to a worker.

```sh
checkmate run begin run-1 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-1 --allow Read --allow Bash
```

When `run begin` prints `needs_decision`, the gate refused the run, and no run exists. The `reason:` lines name the missing approval, the open gaps, or the blocked tests.

### 5. Fix and retest

The factory reads the findings, fixes the code, and makes a new build. Then QA runs the tests again with `--retest-of`. The earlier run does not change.

```sh
checkmate export run run-1 --format json
checkmate run begin run-2 checkout@2 --tests T1,T2,T3 --build "$NEW_SHA" --retest-of run-1
checkmate delegate execute run-2 --allow Read --allow Bash
```

### 6. Accept

```sh
checkmate result accept run-2 --rationale "All tests pass on the new build."
checkmate export run run-2 --format html --out reports/run-2.html
```

## Run early

QA can run the ready tests before the gaps are answered, and before the feature exists. Most tests fail, and this is correct: an early run explores the requirements.

```sh
checkmate plan approve checkout@1 --rationale "Run the ready tests early."
checkmate run begin run-1 checkout@1 --build "$GIT_SHA" --partial ready_only
```

Without `--tests`, `--partial ready_only` selects the ready tests. It prints one line for each test that it leaves out:

```text
completed run-1 tests=T1 startedAt=... browserSession=... deadlineSeconds=600 evidenceDirectory=.checkmate/tmp/run-1/
T2	left_out	blocked by G1
```

## Know who acts next

`checkmate status <planId>` reads the records and prints the loop state, the role that it waits on, and the next command.

```text
completed checkout state=needs_answers waitsOn=oracle revision=1 approval=approved run=run-1
why	1 open blocking gap
next	checkmate gap answer checkout <gapId> --kind <kind> --value "<answer>" --rationale "<why>"
G1	gap	blocking	Does the promotion stack with the loyalty discount?
F1	defect	run-1	medium	T1.A1	Wrong total
```

`checkmate plan list --waits-on factory` lists the plans that wait on the factory. The factory reads the record with `status`, `inbox`, `plan list`, `run show`, `log`, `query`, and `export --format json`.

## Example

One ticket through the loop. Each comment names the role that acts.

```sh
# Factory: set up the target.
checkmate target open shop --base-url http://127.0.0.1:4173 --capabilities browser,http \
  --operations read_catalog,create_order --tool "jira:mcp:Read the ticket."
checkmate delegate setup shop --allow Read --allow Bash

# Planner: plan from the ticket. Unclear requirements become gaps.
checkmate plan open checkout --target shop@1 --objective "Verify checkout totals." --source jira:SHOP-12
checkmate delegate plan checkout --allow Read --allow Bash --allow mcp__jira

# Oracle approves. QA runs the ready tests early and records the new gap G4.
checkmate plan approve checkout@1 --rationale "Run the ready tests early."
checkmate run begin run-1 checkout@1 --build "$GIT_SHA" --partial ready_only
checkmate delegate execute run-1 --allow Read --allow Bash

# Oracle answers G1 and the run gap G4. Planner revises. Oracle approves.
checkmate gap answer checkout G1 --kind clarify --source docs/promo.md \
  --value "The promotion replaces the loyalty discount." --rationale "Product decision."
checkmate gap answer checkout G4 --kind defer --value "Not in this release." --rationale "Product decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate status checkout    # names the revision to approve
checkmate plan approve checkout@3 --rationale "Tests match the answers."

# Factory fixes and builds. QA retests on the new build.
checkmate run begin run-2 checkout@3 --tests T1,T2,T3,T4 --build "$NEW_SHA" --retest-of run-1
checkmate delegate execute run-2 --allow Read --allow Bash

# Oracle accepts when the retest passes.
checkmate result accept run-2 --rationale "All tests pass on the new build."
```

`gap answer` on the run gap G4 first adds G4 to the plan. Here that gives `checkout@2`, so revise writes `checkout@3`. Approve the revision that `checkmate status checkout` names.

## Use a sub-agent instead of delegate

A parent agent in Claude Code can give a stage to a sub-agent that has the Checkmate plugin.

1. Prepare the subject as for `delegate`: `target open`, `plan open`, `gap answer`, or `run begin`.
2. Give the sub-agent the stage and the subject, for example: "Delegated Checkmate plan stage for plan `checkout`. Use the checkmate:plan skill." For execute, give the run ID.
3. The sub-agent does not ask the oracle. It returns `{ status, subject, reasons }`.
4. Check the result in the record with `inbox`, `plan show`, or `run show`. Do not trust the returned words alone.

## Next

- [Decide as the oracle](oracle.md): gaps, plan edits, approvals, and results.
- [Commands](../reference/commands.md): every command and `delegate` in detail.
- [Payloads](../reference/payloads.md): the JSON for requests, plans, and findings.
