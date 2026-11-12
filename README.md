#### □ □ ■ □

## _Checkmate - the QA system of record for agent teams_

<img src="docs/img/onboarding.gif" alt="A planner agent writes a plan with a gap. The caller agent answers the gap. A QA agent finds a defect with evidence. A dev agent fixes it, the retest passes, and the caller accepts the result." width="50%"/>

#

Checkmate is agent-first QA. It is the contract, the evidence layer, and the system of record for a software factory of agents. A planner agent turns a ticket into tests. A QA agent runs the tests on the real application and saves evidence. A dev agent fixes the defects. The caller, an agent or a person, answers the open questions and accepts the result. Checkmate keeps each plan, decision, result, and piece of evidence in one SQLite database, and makes sure that they agree.

Checkmate does not start your agents or connect them. Each agent reads and writes the same records with `checkmate` commands or `/checkmate:*` skills.

- Each requirement maps to tests with explicit assertions.
- Each assertion result needs saved evidence.
- A question that the requirements do not answer becomes a gap. The caller answers it.
- By default, a plan runs only after the caller approves it, and a result counts only after the caller accepts it.

| Mode                                  | Who is the caller               | You need                             |
| ------------------------------------- | ------------------------------- | ------------------------------------ |
| [Team](#team-mode-a-software-factory) | An agent, a script, or a person | The npm CLI and a logged-in `claude` |
| [Solo](#solo-mode-your-claude-code)   | You, in your own Claude Code    | The plugin                           |

## Team mode: a software factory

Each role is an agent or a step that runs `checkmate` commands in the application workspace:

| Role          | What it does                                     | Checkmate interface                                                                            |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Planner agent | Turns the ticket into a plan. Records gaps.      | `delegate plan`, `delegate revise`, or a sub-agent with `/checkmate:plan`, `/checkmate:revise` |
| Caller        | Answers gaps. Approves plans. Accepts results.   | `inbox`, `gap answer`, `plan edit`, `plan approve\|reject`, `result accept\|reject`            |
| QA agent      | Runs the tests. Records results with evidence.   | `delegate execute`, or a sub-agent with `/checkmate:execute`                                   |
| Dev agent     | Fixes the defects. Checkmate does not edit code. | `run show` or `export run` to read the defects                                                 |

Install the npm CLI, version 0.7.0 or later. It contains the plugin and adds `delegate`. Each delegated stage runs in a new Claude Code session, so the `claude` command must be installed and logged in.

```bash
npm i -g @xoxoai/checkmate@^0.7.0
```

One ticket through the factory:

```bash
checkmate target open shop --base-url http://127.0.0.1:4173 --capabilities browser,http \
  --operations read_catalog,create_order
checkmate delegate setup shop --allow Read --allow Bash

# Planner: write the plan. Unclear requirements become gaps.
checkmate plan open checkout --target shop@1 <<'EOF'
{ "objective": "Verify checkout totals.", "context": { "sources": ["docs/checkout.md"] } }
EOF
checkmate delegate plan checkout --allow Read --allow Bash

# Caller: answer the gap, then approve the new revision.
checkmate inbox
checkmate gap answer checkout G1 --kind clarify --source docs/promo.md \
  --value "The promotion replaces the loyalty discount." --rationale "Product decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate plan approve checkout@2 --rationale "Tests match the brief."

# QA: run the tests. Caller: accept the result with the defect.
checkmate run begin run-1 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-1 --allow Read --allow Bash
checkmate result accept run-1 --rationale "The defect in T3 is real."

# Dev: read the defect and fix the code. QA: retest the new build.
checkmate export run run-1 --format md
checkmate run begin run-2 checkout@2 --tests T3 --build "$NEW_SHA" --retest-of run-1
checkmate delegate execute run-2 --allow Read --allow Bash
checkmate result accept run-2 --rationale "T3 passes on the new build."
```

Give each delegated stage at least `--allow Read --allow Bash`. The worker sends JSON on standard input with a heredoc, and the permission check of Claude Code blocks that heredoc under a prefix rule such as `Bash(node *)`. The host still owns the permissions. Add rules for other tools, for example `--allow mcp__jira`.

Each command prints `<status> <subject>` on line 1. `needs_decision` exits with 0, so read the status, not only the exit code. `delegate` does not trust the worker's summary. It reads the recorded change from the database. A retest is a new run. Run 1 does not change. [Workflow](docs/WORKFLOW.md) has each step, the sub-agent mode, and an example with a Jira source.

## Solo mode: your Claude Code

Use the plugin when you work alone. You are the caller. Drive the tests for your own change, or verify the work of a teammate, for example as the QA engineer.

You need the plugin, Node.js 24.12.0 or later, and the tools that your tests use. For browser tests, install Playwright CLI: `npm i -g @playwright/cli`. You do not need the npm CLI.

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Then ask Claude in your application workspace:

```text
/checkmate:setup shop at http://127.0.0.1:4173 with browser and http, operations read_catalog and create_order
/checkmate:plan checkout for shop@1 from docs/checkout.md
/checkmate:ui
```

1. `setup` checks the tools and the target, and saves profile `shop@1`.
2. `plan` reads the sources and writes the tests. Each unclear requirement becomes a gap.
3. `ui` starts the review UI and prints its URL. Open the URL. Answer the gaps, edit and approve the plan, accept results, and download reports there.

Continue in the same session:

```text
/checkmate:revise checkout
/checkmate:execute checkout@2 tests T1,T2,T3 build 1.4.0
/checkmate:report run-1 as html in reports/run-1.html
```

After each step, Claude shows a short table, what it did (`Done:`), and what you must decide (`Next:`). Ask "what waits for me?" at any time. Claude reads the database, not its memory.

<details>
<summary>Screenshots</summary>

From a live run on a local checkout fixture. Claude found the seeded defect: the quote total is 220 PLN, and the requirement expects 240 PLN.

<img src="docs/img/toolkit-2/inbox.jpg" alt="Inbox with gaps, a plan to approve, and a result to accept"/>
<img src="docs/img/toolkit-2/run-defect.jpg" alt="Run page with a failed assertion, its evidence, and the defect"/>

The plans and runs of that live run are in [examples](docs/examples/README.md).

</details>

## How it works

<img src="docs/img/checkmate-infographic.png" alt="One ticket through the software factory: planner, caller, QA, dev, and caller, with each step recorded in Checkmate"/>

- Stages: setup, plan, revise, execute, report. Gap answers, plan approvals, and result acceptance are records with an actor and a rationale.
- A test passes only when all its assertions pass. `inconclusive` means that the evidence cannot show the answer.
- Everything is in `.checkmate/checkmate.db`: requests, plans, decisions, runs, and evidence bytes. Payloads go in on standard input. No other file stays.
- Approved plans and finished runs do not change. A run can continue after a crash.
- The host (Claude Code) owns the model, authentication, tools, and permissions. Checkmate records which tools a stage uses and validates the records. It cannot prove that an observation is true.

## Docs

[Workflow](docs/WORKFLOW.md)  
[CLI](docs/CLI.md)  
[Configuration](docs/CONFIGURATION.md)  
[Evidence and outcomes](docs/EVIDENCE.md)  
[Validation](docs/VALIDATION.md)  
[Development](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE)
