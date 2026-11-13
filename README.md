#### □ □ ■ □

# Checkmate

**The QA system of record for an agent software factory.** Checkmate drives executable requirements, gap discovery, test runs, and evidence capture, and keeps all of it as an auditable record that agents and the factory can read to monitor and improve their work.

<img src="docs/img/onboarding.gif" alt="One ticket in two synced views. Top: a loop of stations for the planner, the oracle, QA, the factory, and the QA retest around the Checkmate record. Below: the same steps on a swimlane timeline with lanes for the planner, the oracle, QA, and the factory, and a Checkmate record lane below. The loop also shows the return path from the QA retest to the planner: new gaps or a plan change give a new revision. Iteration 1: the planner writes plan@1 with open gaps G1 to G3, the oracle answers them, the planner writes plan@2, and the oracle approves it. An early QA run fails three of four tests, with defects F1 to F3 and run gap G4. Iteration 2: the factory builds b2, and the retest passes three tests and finds defect F4. A human edits the plan in the review UI to add G4 as plan@3, the oracle answers G4, the planner writes plan@4, and the oracle approves it. Iteration 3: the factory builds c3, the retest passes all four tests, and the oracle accepts the result. The animation ends with solo mode in Claude Code." width="100%"/>

Checkmate is a CLI and a Claude Code plugin. Its stages give the planner and QA agents their skills and contracts, and Claude Code runs the tools.<br/>
The **oracle** is anyone who can give the answer: a product-owner agent or a person. A human can join at any time in the review UI.<br/>
Checkmate does not start, schedule, or message agents, and it does not change code. The factory does.

## Team mode: the factory loop

| Lane    | Does                                                                              | Writes to the record                                        |
| ------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Planner | An agent runs the Checkmate plan and revise stages. It turns a ticket into tests. | Plan revisions and gaps                                     |
| Oracle  | Answers gaps. Approves plans. Accepts results.                                    | Decisions                                                   |
| QA      | An agent runs the Checkmate execute stage, early and on each new build.           | Runs, evidence, defects, and new gaps                       |
| Factory | Runs the agents and their sandboxes. Builds and fixes the code. Reads the record. | Only what its commands record, such as a run on a new build |
| Human   | Joins in the review UI. Makes the same decisions as the oracle.                   | Decisions and plan edits                                    |

Set up the target, let the planner start the loop, and read what waits for the oracle:

```bash
checkmate target open shop --base-url http://127.0.0.1:4173 \
  --capabilities browser,http --operations read_catalog,create_order
checkmate delegate setup shop --allow Read --allow Bash
checkmate plan open checkout --target shop@1 <<'EOF'
{ "objective": "Verify checkout totals.", "context": { "sources": ["docs/checkout.md"] } }
EOF
checkmate delegate plan checkout --allow Read --allow Bash
checkmate inbox
```

[The full loop](docs/WORKFLOW.md#factory-loop): early runs, gap answers, revisions, retests with `--retest-of`, and acceptance.

To monitor and improve the factory, read the record: `checkmate inbox`, `checkmate log`, `checkmate query "<sql>"` (read-only), and `checkmate export run|plan --format json`.

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

<img src="docs/img/checkmate-infographic.png" alt="Swimlane diagram of one ticket over two iterations. Lanes for the planner, the oracle, QA, and the factory, and a Checkmate record lane below. Each step writes a record: plan@1 with three gaps, approval, an early failed run with defect F1 and gap G4, gap answers, plan@2, a human edit in the review UI that covers G4, and approval. The factory fixes F1 in build b2, which writes no record. The retest passes, and the oracle accepts the result."/>

A failed assertion needs a defect with evidence. A retest is a new run on a new build: earlier runs and approved plans do not change. The host (Claude Code) owns the model, the tools, and the permissions.

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
