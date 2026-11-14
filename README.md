#### □ □ ■ □

# Checkmate

### The QA system of record for an agent software factory.

[![npm version](https://img.shields.io/npm/v/%40xoxoai%2Fcheckmate)](https://www.npmjs.com/package/@xoxoai/checkmate)

Checkmate turns a ticket into tests with exact checks. It records what is unclear as gaps, and it records each test run with its evidence. Agents and people read the same record and make their decisions in it.

<img src="docs/img/onboarding.gif" alt="An animation of one ticket in two synced views. Top: a ring with four stations, the planner and the oracle on the top edge, the factory and QA on the bottom edge, the Checkmate record in the centre, and a human badge for the review UI below. An amber path on the left edge goes from QA back to the planner: new gaps or a plan change give a new revision. Below: the same steps on a swimlane timeline with lanes for the planner, the oracle, QA, and the factory, and a Checkmate record lane at the bottom. Iteration 1: the planner writes plan@1 with open gaps G1 to G3, the oracle answers them, the planner writes plan@2, and the oracle approves it. An early QA run fails three of four tests, with defects F1 to F3 and run gap G4. Iteration 2: the factory builds b2, and QA retests: three tests pass and defect F4 is found. A human edits the plan in the review UI to add G4 as plan@3, the oracle answers G4, the planner writes plan@4, and the oracle approves it. Iteration 3: the factory builds c3, QA retests and all four tests pass, and the oracle accepts the result. The animation ends with solo mode in Claude Code." width="100%"/>

## Four roles, one record

| Role    | Does                                                  | Writes to the record                        |
| ------- | ----------------------------------------------------- | ------------------------------------------- |
| Planner | Turns a ticket into tests. Records what is unclear.   | Plan revisions and gaps                     |
| Oracle  | Answers gaps. Approves plans. Accepts results.        | Decisions                                   |
| QA      | Runs the tests, early and again on each new build.    | Runs, evidence, defects, and new gaps       |
| Factory | Runs the agents and their sandboxes. Builds the code. | Only what its commands record, such as runs |

The oracle is an agent or a person. A human can make the oracle's decisions at any time in the review UI.

Checkmate does not start, schedule, or message agents, and it does not change code. The factory does that. All state is in one SQLite file: `.checkmate/checkmate.db`.

## Two ways to use it

### Solo mode: the plugin in Claude Code

You are the oracle. Install the plugin from the marketplace. You do not need npm.

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Then set up a target, plan, and review:

```text
/checkmate:setup shop at http://127.0.0.1:4173, browser, operations read_catalog and create_order
/checkmate:plan checkout for shop@1: verify checkout totals from docs/checkout.md
/checkmate:ui
```

Continue with [Test in Claude Code](docs/guides/claude-code.md).

### Team mode: the CLI in your factory

Agents share the QA work. Install the CLI:

```sh
npm i -g @xoxoai/checkmate
```

Then open a plan for a ticket, give the plan stage to a Claude Code worker, and read what waits for the oracle:

```sh
checkmate plan open checkout --target shop@1 --objective "Verify checkout totals." --source docs/checkout.md
checkmate delegate plan checkout --allow Read --allow Bash
checkmate inbox
```

Continue with [Run Checkmate from a factory](docs/guides/factory.md).

Both modes need Node.js 24.12.0 or later and Claude Code. Team mode also needs a logged-in `claude` command. For browser tests, install Playwright CLI: `npm i -g @playwright/cli`.

## The review UI

<img src="docs/img/ui/inbox.jpg" alt="The review UI inbox in dark mode. It lists two gaps to answer, one of them from run-7, one plan to approve, and one result to accept." width="100%"/>

The review UI is a local web page for the human oracle. Start it with `/checkmate:ui` or `checkmate ui`. Read [Review in the browser](docs/guides/review-ui.md).

## Manual

**Guides** tell you how to do a task.

- [Test in Claude Code](docs/guides/claude-code.md): solo mode, from setup to the report.
- [Run Checkmate from a factory](docs/guides/factory.md): team mode, the CLI, `delegate`, and the loop.
- [Decide as the oracle](docs/guides/oracle.md): answer gaps, change plans, approve, and accept.
- [Review in the browser](docs/guides/review-ui.md): the pages and actions of the review UI.

**Reference** tells you exactly how a part works.

- [Concepts](docs/reference/concepts.md): the terms, the stages, and who owns what.
- [Commands](docs/reference/commands.md): every command, its output, the statuses, and the loop states.
- [Payloads](docs/reference/payloads.md): the JSON that the commands take on standard input.
- [Runs and evidence](docs/reference/runs.md): results, outcomes, evidence, coverage, and reports.
- [The record](docs/reference/record.md): the database, the actor, the operation log, and the limits.

**More**

- [Examples](docs/examples/README.md): plans and runs exported from a live run.
- [Development](docs/development.md): build, test, release, and the media of this manual.

## License

[MIT](LICENSE)
