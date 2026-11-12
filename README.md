#### □ □ ■ □

## _Checkmate - the QA system of record for an agent software factory_

<img src="docs/img/onboarding.gif" alt="A swimlane timeline of one ticket over three iterations. Iteration 1: the planner agent writes plan@1 with open gaps, the oracle approves it, and an early QA run fails with defect F1 and new gap G4. Iteration 2: the oracle answers the gaps, the planner writes plan@2, a human edits it in the review UI, and the oracle approves it. The dev agent fixes F1, and the retest is partly green. Iteration 3: the dev agent fixes F2, the retest passes, and the oracle accepts the result. Each step writes a record in Checkmate." width="50%"/>

#

Checkmate is the center of a QA-driven software factory. Agents do acceptance-test-driven development: a planner agent turns a ticket into tests, a QA agent runs the tests, and a dev agent writes the code until the tests pass. Checkmate keeps the contract between them: each plan, gap, decision, run, defect, and piece of evidence is a record in one SQLite database.

The **oracle** is anyone who can give the answer: a product-owner agent or a person. The oracle answers gaps, approves plans, and accepts results. A human can join at any time in the review UI and make the same decisions. The docs call the oracle the caller.

Checkmate does not start, schedule, or message your agents. The factory does. The agents coordinate through the records, with `checkmate` commands or `/checkmate:*` skills.

- Each requirement maps to tests with explicit assertions.
- Each assertion result needs saved evidence. A failed assertion needs a defect finding.
- A question that the requirements do not answer becomes a gap. The oracle answers it.
- By default, a plan runs only after the oracle approves it, and a result counts only after the oracle accepts it.

| Mode                                  | Who is the oracle                  | You need                             |
| ------------------------------------- | ---------------------------------- | ------------------------------------ |
| [Team](#team-mode-a-software-factory) | A product-owner agent, or a person | The npm CLI and a logged-in `claude` |
| [Solo](#solo-mode-your-claude-code)   | You, in your own Claude Code       | The plugin                           |

## Team mode: a software factory

One ticket goes around the loop until its tests pass:

1. **Plan.** The planner agent reads the ticket and the other context sources, and writes the tests. The feature does not exist yet, so the first plan has many gaps.
2. **Answer.** The oracle answers the gaps. The planner agent applies the answers in a new plan revision. The oracle approves it.
3. **Run early.** The QA agent runs the ready tests before the feature exists. Most tests fail. This is correct: an early run explores the requirements. Each failed assertion becomes a defect finding with evidence. Unclear behavior becomes a new gap.
4. **Fix.** The dev agent reads the findings and changes the code. Checkmate does not change code.
5. **Retest.** The QA agent runs the tests again on the new build (`--retest-of`). The earlier run does not change. When a run shows new gaps or a plan change, the plan gets a new revision, and the loop continues.
6. **Accept.** When the retest passes, the oracle accepts the result.

| Role          | What it does                                     | Checkmate interface                                                                            |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Planner agent | Writes the plan and records gaps.                | `delegate plan`, `delegate revise`, or a sub-agent with `/checkmate:plan`, `/checkmate:revise` |
| Oracle        | Answers gaps. Approves plans. Accepts results.   | `inbox`, `gap answer`, `plan edit`, `plan approve\|reject`, `result accept\|reject`            |
| QA agent      | Runs the tests. Records results with evidence.   | `run begin [--retest-of]`, then `delegate execute` or a sub-agent with `/checkmate:execute`    |
| Dev agent     | Fixes the defects. Checkmate does not edit code. | `run show` or `export run` to read the findings                                                |
| Human         | Joins at any time. Makes the oracle decisions.   | The review UI: `checkmate ui` or `/checkmate:ui`                                               |

Install the npm CLI, version 0.7.0 or later. It contains the plugin and adds `delegate`. Each delegated stage runs in a new Claude Code session, so the `claude` command must be installed and logged in.

```bash
npm i -g @xoxoai/checkmate@^0.7.0
```

One ticket through the factory:

```bash
checkmate target open shop --base-url http://127.0.0.1:4173 --capabilities browser,http \
  --operations read_catalog,create_order \
  --tool "playwright-cli:cli:Drive the browser." --tool "jira:mcp:Read the ticket."
checkmate delegate setup shop --allow Read --allow Bash

# Iteration 1. Planner: plan from the ticket. Unclear requirements become gaps.
checkmate plan open checkout --target shop@1 <<'EOF'
{ "objective": "Verify checkout totals.", "context": { "sources": ["jira:SHOP-12"] } }
EOF
checkmate delegate plan checkout --allow Read --allow Bash --allow mcp__jira

# Oracle: approve. QA: run the ready tests early. Most fail.
checkmate plan approve checkout@1 --rationale "Run the ready tests early."
checkmate run begin run-1 checkout@1 --tests T1,T2,T3,T4 --build "$GIT_SHA" --partial ready_only
checkmate delegate execute run-1 --allow Read --allow Bash

# Iteration 2. Oracle: answer the gaps. Planner: revise. Oracle: approve.
checkmate inbox
checkmate gap answer checkout G1 --kind clarify --source docs/promo.md \
  --value "The promotion replaces the loyalty discount." --rationale "Product decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate plan approve checkout@2 --rationale "Tests match the answers."

# Dev: read the findings and fix the code. QA: retest on the new build.
checkmate export run run-1 --format md
checkmate run begin run-2 checkout@2 --tests T1,T2,T3,T4 --build "$NEW_SHA" --retest-of run-1
checkmate delegate execute run-2 --allow Read --allow Bash

# Repeat until a retest passes. Oracle: accept.
checkmate result accept run-3 --rationale "All tests pass on the new build."
```

`--partial ready_only` lets a run start while the plan has open gaps. It selects only ready tests. A runtime gap from a run does not change the plan: the oracle adds it with `plan edit` or `Edit plan` in the review UI.

Give each delegated stage at least `--allow Read --allow Bash`. The worker sends JSON on standard input with a heredoc, and the permission check of Claude Code blocks that heredoc under a prefix rule such as `Bash(node *)`. The host still owns the permissions. Add rules for other tools, for example `--allow mcp__jira`.

Each command prints `<status> <subject>` on line 1. `needs_decision` exits with 0, so read the status, not only the exit code. `delegate` does not trust the worker's summary. It reads the recorded change from the database, and records the worker as actor `claude:<stage>`. [Workflow](docs/WORKFLOW.md) has each step, the sub-agent mode, and an example with a Jira source.

## Solo mode: your Claude Code

Use the plugin when you work alone. You are the oracle. Test your own change, or verify the work of a teammate, for example as the QA engineer.

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

<img src="docs/img/checkmate-infographic.png" alt="Swimlane diagram of one ticket over three iterations. Lanes for the planner agent, the oracle, the QA agent, the dev agent, and a human in the review UI. Each step writes a record in the Checkmate lane: plan@1 with gaps, an early failed run with a defect and a new gap, gap answers, plan@2, two retests on new builds, and the accepted result."/>

- Stages: setup, plan, revise, execute, report. Gap answers, plan approvals, and result acceptance are records with an actor and a rationale.
- A test passes only when all its assertions pass. `inconclusive` means that the evidence cannot show the answer.
- Everything is in `.checkmate/checkmate.db`: requests, plans, decisions, runs, and evidence bytes. Payloads go in on standard input. No other file stays.
- Approved plans and finished runs do not change. An edit after approval gives a new revision. A retest is a new run. A run can continue after a crash.
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
