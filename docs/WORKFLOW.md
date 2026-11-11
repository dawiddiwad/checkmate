# Workflow

Checkmate has five stages: setup, plan, revise, execute, and report. Between the stages, the caller makes decisions.

- The **caller** owns the request. The caller answers gaps, approves plans, and accepts results. The caller can be a person in Claude Code or an agent that delegates QA work.
- The **actor** is the name that Checkmate records with each write. Commands use `--actor`, then `CHECKMATE_ACTOR`, then `git config user.name`, then the login name. `delegate` records its workers as `claude:<stage>`.
- The **host** is Claude Code. It owns the model, authentication, tools, and permissions.

All state is in `.checkmate/checkmate.db` in the application workspace. Run the commands and the skills in that workspace.

## In Claude Code

Use this path when you work in Claude Code with the plugin. You do not need the npm CLI. [README](../README.md#use-it-in-claude-code) shows how to install the plugin.

1. Set up the target. Give the base URL, the capabilities, and the operations that tests can do. You can name tools, for example an MCP server:

   ```text
   /checkmate:setup checkout-local at http://127.0.0.1:4173, capabilities browser and http,
   operations read_catalog, create_fixture_order, apply_fixture_discount
   ```

   Claude records the request, checks each tool and the target, and saves profile `checkout-local@1`.

2. Plan. Give the objective and the requirements, or the sources to read:

   ```text
   /checkmate:plan checkout for checkout-local@1. Objective: verify checkout totals. Source: docs/checkout.md
   ```

   Claude writes revision 1. Each unclear requirement becomes an open blocking gap, for example `G1: Does the 40 percent promotion stack with the 20 PLN loyalty discount?`

3. Open the review UI:

   ```text
   /checkmate:ui
   ```

   Open the URL that Claude shows. Answer the gaps in the UI. The UI records your name with each decision: click `actor: <name>` in the header to change it. You can also tell Claude the answer, for example "Answer G1: the promotion replaces the loyalty discount. The total is 240 PLN. Source: product decision."

4. Apply the decisions:

   ```text
   /checkmate:revise checkout
   ```

   Claude writes revision 2. Read it in the UI. To change it, click `Edit plan`. Then approve it.

5. Execute:

   ```text
   /checkmate:execute checkout@2, tests T1,T2,T3, build fixture-build-1, run ID run-1
   ```

   Claude checks the gate, begins the run, records each assertion with evidence, closes each test, records findings, and finishes the run.

6. Accept or reject the result on the run page of the UI.

7. Get the report. On the run page, click `Download report` and select HTML, Markdown, or JSON. Or ask Claude:

   ```text
   /checkmate:report run-1 as html in reports/run-1.html
   ```

After each stage, Claude reports in one format: a Markdown table of the plans, tests, gaps, or runs; a `Done:` line; and a `Next:` line with the decision, who makes it, and the command or UI action. Before Claude answers a question about the state, it reads the database with `inbox`, `plan list`, `plan show`, `run list`, or `run show`.

## From an agent or a script

Use the npm CLI (`npm i -g @xoxoai/checkmate`) when an agent, a CI job, or a script gives QA work to Checkmate. The agent is the caller. It opens each subject, delegates the stage, and makes the decisions. `delegate` needs the `claude` command, installed and logged in.

Read line 1 of each response: `<status> <subject>`. `completed` and `needs_decision` exit with 0. `needs_decision` means that the caller must decide or give input, for example for open gaps or a refused gate. Read the `reason:` lines. [CLI](CLI.md#output-and-exit-codes) lists every status.

Give each delegated stage at least `--allow Read --allow Bash`. A prefix rule such as `Bash(node *)` is not sufficient: the permission check of Claude Code blocks the heredoc that sends a JSON payload. [CLI](CLI.md#delegated-stages) has the details. The host owns the permissions.

Set up the target with its tools: `--tool <name>:<cli|mcp|skill>:<purpose>`. When no tool is named for a capability, the setup stage adds `playwright-cli` for `browser` and `node` for `http`. This example reads the requirements from a Jira ticket through the `jira` MCP server of the host:

```sh
checkmate target open checkout-local --base-url "$BASE_URL" --capabilities browser,http \
  --operations read_catalog,create_fixture_order,apply_fixture_discount \
  --tool "playwright-cli:cli:Drive the browser." --tool "jira:mcp:Read the acceptance criteria."
checkmate delegate setup checkout-local --allow Read --allow Bash
```

Open the plan with its sources and instructions, then delegate the plan stage. Allow the tools that read the sources. `mcp__jira` allows every tool of the `jira` server. The worker uses the MCP servers of the host configuration:

```sh
checkmate plan open checkout --target checkout-local@1 <<'EOF'
{
  "objective": "Verify checkout totals and identify missing acceptance decisions.",
  "context": { "sources": ["jira:SHOP-12"], "instructions": "Use the acceptance criteria only." }
}
EOF
checkmate delegate plan checkout --allow Read --allow Bash --allow mcp__jira
```

A plan with gaps gives `needs_decision` with one `reason:` line for each open blocking gap. This is a correct result.

Then read what waits for a decision, and decide:

```sh
checkmate inbox
checkmate gap answer checkout G1 --kind clarify --source decisions#promotion \
  --value "The promotion replaces the loyalty discount. The quote total is 240 PLN." \
  --rationale "Product owner decision."
checkmate gap answer checkout G2 --kind defer \
  --value "Refunds are out of scope for this release." --rationale "Product owner decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate plan show checkout@2
checkmate plan approve checkout@2 --rationale "Tests and assertions match the brief."
```

Execute, then accept or reject the result:

```sh
checkmate run begin run-1 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-1 --allow Read --allow Bash
checkmate run show run-1
checkmate result accept run-1 --rationale "The defect in T3 is real. Fix before release."
checkmate export run run-1 --format html --out reports/run-1.html
```

- When `run begin` prints `needs_decision`, the gate refused the run, and no run exists. The `reason:` lines name the missing approval, the open gaps, or the blocked tests.
- `delegate` does not trust the worker's summary. It reads the database and returns the response of the recorded command. Read [CLI](CLI.md#delegated-stages) for the permissions and deadlines.
- Without `--out`, `export` prints the report on standard output.

## Sub-agents in Claude Code

A parent agent in Claude Code can give a stage to a sub-agent that has the Checkmate plugin. The sub-agent uses the stage skill and the plugin CLI to write to the database. It does not ask the caller. It returns `{ status, subject, reasons }`.

Prepare the subject first, as for `delegate`: `target open` for setup, `plan open` for plan, `gap answer` for revise, and `run begin` for execute. The sub-agent does not record a request. Then give it the stage and the subject, for example: "Delegated Checkmate plan stage for plan `checkout`. Use the checkmate:plan skill." For execute, give the run ID.

The parent checks the result in the database with `inbox`, `plan show`, or `run show`. When the parent is the caller, it makes the decisions with the same commands as an external agent.

The plugin has no global `checkmate` command. Its CLI is `node <plugin root>/dist/checkmate.js`. A Checkmate skill shows the plugin root when it loads. To get a `checkmate` command, install the npm CLI.

## Decisions

| Decision          | Command                                                  | In the UI          |
| ----------------- | -------------------------------------------------------- | ------------------ |
| Answer a gap      | `checkmate gap answer <planId> <gapId> --kind ...`       | Inbox or plan page |
| Change a plan     | `checkmate plan edit <planId@rev>` with a full candidate | `Edit plan`        |
| Approve or reject | `checkmate plan approve\|reject <planId@rev>`            | Plan page          |
| Accept or reject  | `checkmate result accept\|reject <runId>`                | Run page           |

- `checkmate inbox` lists the gaps to answer, the plans to approve, and the results to accept.
- A gap answer is a pending decision. The revise stage applies it and writes the next revision.
- `plan edit` changes the latest revision. A revision without an approval and without a run changes in place, and the log records the edit. An approved or used revision gives a new revision. [Configuration](CONFIGURATION.md#plan-edit) shows how to get the current candidate.
- A gap answer, an approval, and a result decision need a rationale. Add `--expect-sha <digest>` to stop the decision when the snapshot changed.

## Retest

A retest is a new run of the same plan on a new build. The first run does not change.

```sh
checkmate run begin run-2 checkout@2 --tests T2,T3 --build "$NEW_SHA" --retest-of run-1
checkmate delegate execute run-2 --allow Read --allow Bash
```

A narrow retest keeps the requirements of the tests that it did not select uncovered.
