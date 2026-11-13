#### □ □ ■ □

# Checkmate

**The QA system of record for an agent software factory.** Checkmate keeps the requirements, gaps, test runs, and evidence as one auditable record that your agents and your factory can read.

<img src="docs/img/onboarding.gif" alt="One ticket in two synced views. Top: a ring with four stations, the planner and the oracle on the top edge, the factory and QA on the bottom edge, the Checkmate record in the centre, and a human badge for the review UI below. An amber path on the left edge goes from QA back to the planner: new gaps or a plan change give a new revision. Below: the same steps on a swimlane timeline with lanes for the planner, the oracle, QA, and the factory, and a Checkmate record lane at the bottom. Iteration 1: the planner writes plan@1 with open gaps G1 to G3, the oracle answers them, the planner writes plan@2, and the oracle approves it. An early QA run fails three of four tests, with defects F1 to F3 and run gap G4. Iteration 2: the factory builds b2, and QA retests: three tests pass and defect F4 is found. A human edits the plan in the review UI to add G4 as plan@3, the oracle answers G4, the planner writes plan@4, and the oracle approves it. Iteration 3: the factory builds c3, QA retests and all four tests pass, and the oracle accepts the result. The animation ends with solo mode in Claude Code." width="100%"/>

The **oracle** answers gaps, approves plans, and accepts results. It is a product-owner agent or a person. The docs call it the caller.<br/>
Checkmate does not start, schedule, or message agents, and it does not change code. Your factory does.

## In your factory

Your factory runs the agents, their sandboxes, and the builds. Checkmate gives the planner and QA agents their stages, and Claude Code runs the tools. Install the CLI with `npm i -g @xoxoai/checkmate@^0.7.0`. It needs Node.js 24.12.0 or later and a logged-in `claude` command. Set up each target once with `checkmate target open` and `checkmate delegate setup`.

1. **Plan.** Open a plan for the ticket with `checkmate plan open checkout --target shop@1`. It reads the request on standard input: the objective and the sources ([Plan request](docs/CONFIGURATION.md#plan-request)). The planner agent writes the tests. Unclear requirements become gaps.

   ```sh
   checkmate delegate plan checkout --allow Read --allow Bash
   ```

2. **Decide.** The oracle reads what waits for it, answers the gaps, and approves the plan. A human can make the same decisions in the review UI with `checkmate ui`.

   ```sh
   checkmate inbox
   ```

3. **Test.** Open a run on the current build with `checkmate run begin`. QA runs the ready tests early, before the feature exists, so most fail. Each failure is a defect with evidence. Unclear behavior becomes a new gap.

   ```sh
   checkmate delegate execute run-1 --allow Read --allow Bash
   ```

4. **Build and retest.** The factory reads the findings, fixes the code, and builds. QA runs the tests again on the new build. Earlier runs do not change. New gaps or a plan change give a new revision. When a retest passes, the oracle accepts the result.

   ```sh
   checkmate run begin run-2 checkout@2 --tests T1,T2,T3,T4 --build "$NEW_SHA" --retest-of run-1
   ```

**What your factory can read:** `checkmate inbox`, `checkmate log`, `checkmate query "<sql>"` (read-only), and `checkmate export run|plan --format json`.

[The full factory loop](docs/WORKFLOW.md#factory-loop) shows each command. Give each delegated stage at least `--allow Read --allow Bash`.

## Solo mode: your Claude Code

You are the oracle. Test your own work, or verify the work of a teammate. The plugin does not need the npm CLI. It needs Claude Code and Node.js 24.12.0 or later. Install it with `/plugin marketplace add dawiddiwad/checkmate` and `/plugin install checkmate@checkmate`. Then:

```text
/checkmate:setup shop at http://127.0.0.1:4173, browser, operations read_catalog and create_order
/checkmate:plan checkout for shop@1: verify checkout totals from docs/checkout.md
/checkmate:ui
```

[The full path in Claude Code](docs/WORKFLOW.md#in-claude-code): setup, plan, review, revise, execute, and report. For browser tests, install Playwright CLI: `npm i -g @playwright/cli`.

## Docs

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
