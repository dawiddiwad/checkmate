#### □ □ ■ □

# Checkmate

**The QA system of record for an agent software factory.** Agents plan, test, and fix against one shared record, until the tests pass.

<img src="docs/img/onboarding.gif" alt="Swimlane timeline of one ticket. Iteration 1: the planner agent writes plan@1 with three gaps, the oracle approves it, and an early QA run fails with defect F1 and new gap G4. Iteration 2: the oracle answers the gaps, the planner writes plan@2, a human edits it in the review UI to cover G4, and the oracle approves it. The dev agent fixes F1, the QA retest on build b2 passes, and the oracle accepts the result. Each step writes a record in Checkmate." width="50%"/>

Checkmate is a CLI and a Claude Code plugin. Each plan, gap, decision, run, defect, and piece of evidence is a record in one SQLite database.<br/>
The **oracle** is anyone who can give the answer: a product-owner agent or a person. A human can join at any time in the review UI.<br/>
Checkmate does not start your agents or change code. The factory does. The agents meet in the record.

## Team mode: the factory loop

| Lane          | Does                                                | Writes to the record              |
| ------------- | --------------------------------------------------- | --------------------------------- |
| Planner agent | Turns the ticket into tests.                        | Plan revisions and gaps           |
| Oracle        | Answers gaps. Approves plans. Accepts results.      | Decisions                         |
| QA agent      | Runs the tests early, then again on each new build. | Runs, evidence, defects, new gaps |
| Dev agent     | Fixes the code.                                     | Nothing. It reads the defects.    |
| Human         | Joins in the review UI. Makes the same decisions.   | Decisions and plan edits          |

After `target open` and `delegate setup`, the planner starts the loop and the oracle reads what waits:

```bash
checkmate plan open checkout --target shop@1 <<'EOF'
{ "objective": "Verify checkout totals.", "context": { "sources": ["docs/checkout.md"] } }
EOF
checkmate delegate plan checkout --allow Read --allow Bash
checkmate inbox
```

[The full loop](docs/WORKFLOW.md#factory-loop): early runs, gap answers, revisions, retests with `--retest-of`, and acceptance.

## Solo mode: your Claude Code

You are the oracle. Test your own work, or verify the work of a teammate.

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
/checkmate:setup shop at http://127.0.0.1:4173, browser, operations read_catalog and create_order
/checkmate:plan checkout for shop@1 from docs/checkout.md
/checkmate:ui
```

[The full path in Claude Code](docs/WORKFLOW.md#in-claude-code): setup, plan, review, revise, execute, and report.

## How it works

<img src="docs/img/checkmate-infographic.png" alt="Swimlane diagram of one ticket over two iterations. Lanes for the planner agent, the oracle, the QA agent, and the dev agent, and a Checkmate record lane below. Each step writes a record: plan@1 with three gaps, approval, an early failed run with defect F1 and gap G4, gap answers, plan@2, a human edit in the review UI that covers G4, approval, a retest on build b2 that passes, and the accepted result."/>

Each step writes a record. A failed assertion needs a defect with evidence. A retest is a new run on a new build: earlier runs and approved plans do not change. The host (Claude Code) owns the model, the tools, and the permissions.

## Install

| Mode | Install                             | Requirements                                                   |
| ---- | ----------------------------------- | -------------------------------------------------------------- |
| Solo | The plugin, as above                | Claude Code, Node.js 24.12.0 or later, the tools of your tests |
| Team | `npm i -g @xoxoai/checkmate@^0.7.0` | The same, and a logged-in `claude` command                     |

For browser tests, install Playwright CLI: `npm i -g @playwright/cli`. The plugin does not need the npm CLI. Give each delegated stage at least `--allow Read --allow Bash`.

## Docs

The docs call the oracle the caller.

| Doc                                       | What you find there                                       |
| ----------------------------------------- | --------------------------------------------------------- |
| [Workflow](docs/WORKFLOW.md)              | Each stage and decision, the factory loop, and sub-agents |
| [CLI](docs/CLI.md)                        | Commands, statuses, delegated stages, and the review UI   |
| [Configuration](docs/CONFIGURATION.md)    | Targets, plans, policies, runtime gaps, and the actor     |
| [Evidence and outcomes](docs/EVIDENCE.md) | Assertions, evidence, outcomes, coverage, and reports     |
| [Validation](docs/VALIDATION.md)          | What the tests and the live run check                     |
| [Examples](docs/examples/README.md)       | Plans and runs exported from a live run                   |
| [Development](docs/DEVELOPMENT.md)        | Build, test, release, and the media of this page          |

## License

[MIT](LICENSE)
