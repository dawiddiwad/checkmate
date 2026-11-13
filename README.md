#### □ □ ■ □

# Checkmate

**The QA system of record for an agent software factory.** Checkmate drives executable requirements, gap discovery, test runs, and evidence capture, and keeps all of it as an auditable record that agents and the factory can read.

<img src="docs/img/onboarding.gif" alt="One ticket in two synced views. Top: a ring with four stations, the planner and the oracle on the top edge, the factory and QA on the bottom edge, the Checkmate record in the centre, and a human badge for the review UI below. An amber path on the left edge goes from QA back to the planner: new gaps or a plan change give a new revision. Below: the same steps on a swimlane timeline with lanes for the planner, the oracle, QA, and the factory, and a Checkmate record lane at the bottom. Iteration 1: the planner writes plan@1 with open gaps G1 to G3, the oracle answers them, the planner writes plan@2, and the oracle approves it. An early QA run fails three of four tests, with defects F1 to F3 and run gap G4. Iteration 2: the factory builds b2, and QA retests: three tests pass and defect F4 is found. A human edits the plan in the review UI to add G4 as plan@3, the oracle answers G4, the planner writes plan@4, and the oracle approves it. Iteration 3: the factory builds c3, QA retests and all four tests pass, and the oracle accepts the result. The animation ends with solo mode in Claude Code." width="100%"/>

The **oracle** answers gaps, approves plans, and accepts results. It is a product-owner agent or a person. The docs call it the caller.<br/>
Checkmate does not start, schedule, or message agents, and it does not change code. Your factory does.

## Four roles

| Role    | What it does                                                    | What it writes to the record                |
| ------- | --------------------------------------------------------------- | ------------------------------------------- |
| Planner | Turns a ticket into tests. Records the gaps.                    | Plan revisions and gaps                     |
| Oracle  | Answers gaps. Approves plans. Accepts results.                  | Decisions                                   |
| QA      | Runs the tests, early and again on each new build.              | Runs, evidence, defects, and new gaps       |
| Factory | Runs the agents and their sandboxes. Builds and fixes the code. | Only what its commands record, such as runs |

A human can make the oracle's decisions at any time in the review UI.

## Team mode

Install the CLI with `npm i -g @xoxoai/checkmate@^0.7.0` and set up a target with `checkmate target open` and `checkmate delegate setup`. Then the factory opens a plan for each ticket, lets the planner write it, and reads what waits for the oracle:

```sh
checkmate plan open checkout --target shop@1 < request.json
checkmate delegate plan checkout --allow Read --allow Bash
checkmate inbox
```

`request.json` holds the objective and the sources ([Plan request](docs/CONFIGURATION.md#plan-request)). Your factory can read the record with `inbox`, `log`, `query` (read-only), and `export --format json`. [The factory loop](docs/WORKFLOW.md#factory-loop) shows each step, from the early red run to acceptance.

## Solo mode: your Claude Code

You are the oracle. Test your own work, or verify the work of a teammate. Install the plugin with `/plugin marketplace add dawiddiwad/checkmate` and `/plugin install checkmate@checkmate`. It does not need the npm CLI.

```text
/checkmate:setup shop at http://127.0.0.1:4173, browser, operations read_catalog and create_order
/checkmate:plan checkout for shop@1: verify checkout totals from docs/checkout.md
/checkmate:ui
```

[The full path in Claude Code](docs/WORKFLOW.md#in-claude-code): setup, plan, review, revise, execute, and report.

Both modes need Claude Code and Node.js 24.12.0 or later. Team mode also needs a logged-in `claude` command. For browser tests, install Playwright CLI: `npm i -g @playwright/cli`.

## Docs

- [Workflow](docs/WORKFLOW.md): each stage and decision, the factory loop, and sub-agents
- [CLI](docs/CLI.md): commands, statuses, delegated stages, and the review UI
- [Configuration](docs/CONFIGURATION.md): targets, plans, policies, runtime gaps, and the actor
- [Evidence and outcomes](docs/EVIDENCE.md): assertions, evidence, outcomes, coverage, and reports
- [Validation](docs/VALIDATION.md): what the tests and the live run check
- [Examples](docs/examples/README.md): plans and runs exported from a live run
- [Development](docs/DEVELOPMENT.md): build, test, release, and the media of this page

## License

[MIT](LICENSE)
