#### □ □ ■ □

# Checkmate

### The QA system of record for an agent software factory.

[![npm version](https://img.shields.io/npm/v/%40xoxoai%2Fcheckmate)](https://www.npmjs.com/package/@xoxoai/checkmate)

Checkmate turns a ticket into tests that an agent can run. It records the open questions, guides each test run, and keeps the evidence and every decision in one database. Agents and people read and write that record.

<img src="docs/img/onboarding.gif" alt="An animation of one ticket in two synced views. Top: a ring with four stations, the planner and the oracle on the top edge, the factory and QA on the bottom edge, the Checkmate record in the centre, and a human badge for the review UI below. An amber path on the left edge goes from QA back to the planner: new gaps or a plan change give a new revision. Below: the same steps on a swimlane timeline with lanes for the planner, the oracle, QA, and the factory, and a Checkmate record lane at the bottom. Iteration 1: the planner writes plan@1 with open gaps G1 to G3, the oracle answers them, the planner writes plan@2, and the oracle approves it. An early QA run fails three of four tests, with defects F1 to F3 and run gap G4. Iteration 2: the factory builds b2, and QA retests: three tests pass and defect F4 is found. A human edits the plan in the review UI to add G4 as plan@3, the oracle answers G4, the planner writes plan@4, and the oracle approves it. Iteration 3: the factory builds c3, QA retests and all four tests pass, and the oracle accepts the result. The animation ends with solo mode in Claude Code." width="100%"/>

## In one minute

- The **planner** turns a ticket into tests with exact assertions. Each unclear requirement becomes a gap.
- The **oracle** answers gaps, approves plans, and accepts results. The oracle is an agent or a person.
- **QA** runs the tests, early and again on each new build. It records each result with its evidence, and it records defects and new gaps.
- The **factory** runs the agents and their sandboxes, and builds the code. Checkmate does not start, schedule, or message agents, and it does not change code.
- The record is one SQLite file: `.checkmate/checkmate.db`. A human can make the oracle's decisions in the review UI at any time.

## Solo start: the plugin in Claude Code

You are the oracle. Install the plugin from the marketplace. You do not need npm.

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Then set up a target, plan a ticket, and open the review UI:

```text
/checkmate:setup shop at http://127.0.0.1:4173, browser, operations read_catalog and create_order
/checkmate:plan checkout for shop@1: verify checkout totals from docs/checkout.md
/checkmate:ui
```

Read [Test in Claude Code](docs/guides/claude-code.md).

## Team start: the CLI in your factory

Your agents share the work. Install the CLI:

```sh
npm i -g @xoxoai/checkmate
```

Then set up a target, open a plan for a ticket, and let a planner write it:

```sh
checkmate target open shop --base-url http://127.0.0.1:4173 \
  --capabilities browser,http --operations read_catalog,create_order
checkmate delegate setup shop --allow Read --allow Bash
checkmate plan open checkout --target shop@1 \
  --objective "Verify checkout totals." --source docs/checkout.md
checkmate delegate plan checkout --allow Read --allow Bash
checkmate status checkout
```

Read [Run Checkmate from a factory](docs/guides/factory.md).

Both ways need Node.js 24.12.0 or later and Claude Code. The team start also needs a logged-in `claude` command. For browser tests, install Playwright CLI: `npm i -g @playwright/cli`.

## Documentation

| To do this                                     | Read                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| Test your work in Claude Code                  | [Test in Claude Code](docs/guides/claude-code.md)      |
| Connect Checkmate to your agents               | [Run Checkmate from a factory](docs/guides/factory.md) |
| Answer gaps, approve plans, and accept results | [Decide as the oracle](docs/guides/oracle.md)          |
| Make the decisions in the browser              | [Review in the browser](docs/guides/review-ui.md)      |
| Learn the terms and who owns what              | [Concepts](docs/reference/concepts.md)                 |
| Find a command, a status, or a loop state      | [Commands](docs/reference/commands.md)                 |
| Write a JSON payload                           | [Payloads](docs/reference/payloads.md)                 |
| Read outcomes, evidence, and coverage          | [Runs and evidence](docs/reference/runs.md)            |
| Know what the database keeps, and its limits   | [The record](docs/reference/record.md)                 |
| See real plans and reports                     | [Examples](docs/examples/README.md)                    |
| Build, test, or release Checkmate              | [Development](docs/development.md)                     |

## License

[MIT](LICENSE)
