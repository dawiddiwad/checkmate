#### □ □ ■ □

# Checkmate

### The QA system of record for an agent software factory.

Checkmate turns a ticket into tests. It records each run, its evidence, open questions, and oracle decisions in one local SQLite record. Agents and people use the same record.

[![The QA loop on ticket SHOP-12: QA explores build b1 and finds 3 gaps and 2 defects. The oracle answers, the planner saves plan@2, and QA follows up. The oracle hands the defects to the factory. Build b2 has 1 defect and 2 new gaps; the oracle escalates the gaps to a human, the planner saves plan@3, and the factory delivers build b3. QA finds nothing new, the oracle accepts and promotes the tests, and a permanent run confirms them. Then three ways to run Checkmate: a solo developer with the Claude Code plugin or the Pi extension, a software factory that calls one command per stage and waits on exit 3, and a CI job that runs the promoted tests and fails on the gate.](docs/img/onboarding.gif)](docs/img/onboarding.gif)

The review UI shows what waits for you, here a blocking question that you answer in the drawer before QA continues.

[![The review UI with a blocking refund question open in the answer drawer.](docs/media/ui/review.png)](docs/media/ui/review.png)

## In one minute

- The **planner** turns a ticket into rules and tests with exact assertions. A deterministic check names what it observes and the value it expects, and code gives the verdict. Each unclear requirement becomes a gap.
- The **oracle** answers gaps, approves plans, decides findings, accepts results, and promotes passing tests. The oracle is an agent or a person.
- **QA** explores each build and runs each test in its own child, early and again on each new build. It records each result with its evidence, and it records defects and new gaps.
- The **factory** builds the code, starts the application, and fixes defects. When asked, Checkmate starts the planner and the testers through the host, Claude Code or Pi. It does not change code or start the application.
- The record is one SQLite file: `.checkmate/checkmate.db`. A human can make the oracle's decisions in the review UI or its chat at any time.

## Solo mode: the plugin in Claude Code or the extension in Pi

You are the oracle. In Claude Code, install the plugin from the marketplace. You do not need npm: the plugin ships the CLI.

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Then test a change and open the review UI. The first test asks for the URL of the running application and how its test data stays safe, and sets up the target:

```text
/checkmate:test the checkout change in docs/checkout.md at http://127.0.0.1:4173
/checkmate:ui
```

In Pi, install the extension in the project, then use `/checkmate <request>` and `/checkmate-ui`. The extension also ships the CLI.

```sh
pi install npm:@xoxoai/checkmate -l
```

A factory that runs its agents in Claude Code or Pi can use the plugin or the extension in the same way. Read [Start Checkmate](docs/start.md#use-a-host-plugin) and [Local QA with a human oracle](docs/local-qa.md).

## Team mode: the CLI in your factory

Use the CLI on its own when your factory has its own harness, for example in CI/CD. Install the CLI:

```sh
npm i -g @xoxoai/checkmate
```

Then set up a target with its data kind, open a plan for a ticket, and let a planner write it:

```sh
checkmate setup --url http://127.0.0.1:4173 --target shop \
  --data environment --policy "The pipeline gives each run fresh data."
checkmate plan open checkout --target shop@1 \
  --objective "Verify checkout totals." --source docs/checkout.md
checkmate delegate plan checkout --allow Read --allow Bash
checkmate status checkout
```

For one-shot QA in a pipeline, `checkmate test <planId>` plans, explores, stores the defects as the run `findings-<explorationId>`, and saves plan revision 1 when the plan has none. `checkmate run show <runId> --gate` exits 0 only when every selected test passed and coverage is complete. `checkmate status <planId> --fail-on-blocked` exits 3 when an open blocking gap exists or the plan waits on the oracle. Read [Use Checkmate from a factory](docs/factory.md).

Both modes need Node.js 24.12.0 or later. The planner and the testers need Claude Code or Pi, configured in the host. The host owns models, credentials, tools, and permissions. For browser tests, install Playwright CLI (`npm i -g @playwright/cli`) and name a Chrome or Chromium executable in `.playwright/cli.config.json`. Setup refuses a browser target without it.

## Documentation

| To do this                                     | Read                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Test your work in Claude Code or Pi            | [Start Checkmate](docs/start.md)                                                   |
| Connect Checkmate to your agents               | [Use Checkmate from a factory](docs/factory.md)                                    |
| Answer gaps, approve plans, and accept results | [Local QA with a human oracle](docs/local-qa.md)                                   |
| Make the decisions in the browser              | [Start a change in the review UI](docs/local-qa.md#start-a-change)                 |
| Learn the roles and who owns what              | [Use Checkmate from a factory](docs/factory.md)                                    |
| Find a command, a status, or a loop state      | [CLI and record reference](docs/reference.md)                                      |
| Write a JSON payload                           | [Plans and contracts](docs/reference.md#plans-and-contracts)                       |
| Read outcomes, the gate, and exit codes        | [Exit codes for a pipeline](docs/factory.md#exit-codes-for-a-pipeline)             |
| Keep test data safe                            | [Data kinds, prepare, and cleanup](docs/factory.md#data-kinds-prepare-and-cleanup) |
| Know what the database keeps, and its limits   | [Record and limits](docs/reference.md#record-and-limits)                           |
| Build, test, or release Checkmate              | [Develop Checkmate](docs/development.md)                                           |

## License

[MIT](LICENSE)
