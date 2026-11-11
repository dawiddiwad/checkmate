#### □ □ ■ □

## _Checkmate - QA workflows for Claude Code_

<img src="docs/img/onboarding.gif" alt="onboarding" width="50%"/>

#

Checkmate is a Claude Code plugin and a CLI for evidence-based QA. Claude tests a running application with real tools, for example a browser or HTTP. Checkmate stores the plan, the decisions, and the results in one SQLite database, and checks that they are consistent.

- Each requirement maps to tests with explicit assertions.
- Each assertion result needs saved evidence.
- A question that the requirements do not answer becomes a gap. The caller answers it: you, or the agent that delegated the work.
- By default, a plan runs only after the caller approves it, and a result counts only after the caller accepts it.

## Use it in Claude Code

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

## Use it from an agent or a script

Another agent, a CI job, or a script can give QA work to Checkmate with the npm CLI. The CLI contains the plugin and adds `delegate`. Each delegated stage runs in a new Claude Code session, so the `claude` command must be installed and logged in.

```bash
npm i -g @xoxoai/checkmate
```

```bash
checkmate target open shop --base-url http://127.0.0.1:4173 --capabilities browser,http \
  --operations read_catalog,create_order
checkmate delegate setup shop --allow Read --allow Bash

checkmate plan open checkout --target shop@1 <<'EOF'
{ "objective": "Verify checkout totals.", "context": { "sources": ["docs/checkout.md"] } }
EOF
checkmate delegate plan checkout --allow Read --allow Bash

checkmate inbox
checkmate gap answer checkout G1 --kind clarify --source docs/promo.md \
  --value "The promotion replaces the loyalty discount." --rationale "Product decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate plan approve checkout@2 --rationale "Tests match the brief."

checkmate run begin run-1 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-1 --allow Read --allow Bash
checkmate result accept run-1 --rationale "The defect in T3 is real."
checkmate export run run-1 --format md
```

Give each delegated stage at least `--allow Read --allow Bash`. The worker sends JSON on standard input with a heredoc, and the permission check of Claude Code blocks that heredoc under a prefix rule such as `Bash(node *)`. The host still owns the permissions. Add rules for other tools, for example `--allow mcp__jira`.

Each command prints `<status> <subject>` on line 1. `needs_decision` exits with 0, so read the status, not only the exit code. `delegate` does not trust the worker's summary. It reads the recorded change from the database. A Claude sub-agent that has the plugin can run the same stages with the skills. [Workflow](docs/WORKFLOW.md) has each step and each mode, and an example with a Jira source.

<details>
<summary>Screenshots</summary>

From a live run on a local checkout fixture. Claude found the seeded defect: the quote total is 220 PLN, and the requirement expects 240 PLN.

<img src="docs/img/toolkit-2/inbox.jpg" alt="Inbox with gaps, a plan to approve, and a result to accept"/>
<img src="docs/img/toolkit-2/run-defect.jpg" alt="Run page with a failed assertion, its evidence, and the defect"/>

The plans and runs of that live run are in [examples](docs/examples/README.md).

</details>

## How it works

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
