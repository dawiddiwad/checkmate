#### □ □ ■ □

# Checkmate

### The QA system of record for an agent software factory.

Checkmate turns a ticket into tests. It records each run, its evidence, open questions, and oracle decisions in one local SQLite record. Agents and people use the same record.

[![A build-first QA loop: the planner records gaps, the oracle answers and approves the plan, the factory builds b1, QA explores and runs one child per test, and the gate exits 1 on a defect. The factory builds b2, QA retests, the gate passes, and the oracle accepts and promotes the tests. Then three ways to run Checkmate: a solo developer with the Claude Code plugin or the Pi extension, a software factory that calls one command per stage and waits on exit 3, and a CI job that runs the promoted tests and fails on the gate.](docs/img/onboarding.gif)](docs/img/onboarding.gif)

[![The review UI with a blocking refund question open in the answer drawer.](docs/media/ui/review.png)](docs/media/ui/review.png)

The review UI shows what waits for you, here a blocking question that you answer in the drawer before QA continues.

## Start in a project

Use Node.js 24.12.0 or later. Start the application you want to test. Then install Checkmate in its project and open the review UI:

```sh
npm install --save-dev @xoxoai/checkmate
npx checkmate ui
```

Open the printed URL. Set up the application if Checkmate asks, then choose **New change**. [Start Checkmate](docs/start.md) gives the requirements, the data kinds, and the host setup.

## Where to go next

- **Test a change on your own:** [Local QA](docs/local-qa.md).
- **Use Claude Code or Pi:** run `/checkmate:test` or `/checkmate <ticket>`. [Use a host plugin](docs/start.md#use-a-host-plugin).
- **Answer the questions as the oracle:** open **Needs you** or run `checkmate inbox`. [Answer a gap](docs/local-qa.md#answer-a-gap-and-continue).
- **Drive Checkmate from a software factory:** [Factory workflows](docs/factory.md).
- **Gate a CI job:** run `checkmate run show <runId> --gate`. [Exit codes for a pipeline](docs/factory.md#exit-codes-for-a-pipeline).
- **Test a system that you cannot reset:** [Data kinds](docs/factory.md#data-kinds-prepare-and-cleanup).
- **Look up a command or state:** [CLI and record reference](docs/reference.md).
- **Contribute:** [Develop Checkmate](docs/development.md).

## License

[MIT](LICENSE)
