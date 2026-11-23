#### □ □ ■ □

# Checkmate

### The QA system of record for an agent software factory.

Checkmate turns a ticket into tests. It records each run, its evidence, open questions, and oracle decisions in one local SQLite record. Agents and people use the same record.

The illustration shows the build-first loop. The last scenes show the review UI on sample records.

[![A build-first QA loop: the planner records gaps, the oracle answers and approves the plan, the factory builds b1, QA explores and runs one child per test, and the gate exits 1 on a defect. The factory builds b2, QA retests, the gate passes, and the oracle accepts and promotes the tests. The review UI then shows the plan, the run with its defect, a chat that answers and records a gap answer, the model picker, and the next step.](docs/img/onboarding.gif)](docs/img/onboarding.gif)

## Start in a project

Use Node.js 24.12.0 or later. Start the application you want to test. Then install Checkmate in the project and open its review UI:

```sh
cd /path/to/your/project
npm install --save-dev @xoxoai/checkmate
npx checkmate ui
```

Open the URL that Checkmate prints. If no target exists, follow **Set up the application**; the new-change form opens after setup. Otherwise, choose **New change**. Enter a ticket or source file and start the test. Checkmate records the work in `.checkmate/checkmate.db` in this project.

Setup records a data kind: a reset command, the environment, or isolation. A run that can change data needs one. Without it, Checkmate refuses the run and names the fix. [Start Checkmate](docs/start.md) gives the requirements.

Run `checkmate --version` to check the build that runs. A `warning:` line means that the `checkmate` on `PATH` is another build. Remove that copy with `npm uninstall -g @xoxoai/checkmate` if you do not use it.

For delegated planning or testing, configure Claude Code or Pi in the host. The host owns models, credentials, tools, and permissions. Checkmate does not start your application.

## Choose a path

| You are                           | Do this                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A developer testing a change      | Run `npx checkmate ui` and choose **New change**. [Local QA](docs/local-qa.md)                                                                       |
| A Claude Code user                | Install the plugin, then ask `/checkmate:test` to test your ticket. [Plugin setup](docs/start.md#use-a-host-plugin)                                  |
| A Pi user                         | Run `pi install npm:@xoxoai/checkmate -l`, then `/checkmate <ticket>`. [Plugin setup](docs/start.md#use-a-host-plugin)                               |
| The person who answers questions  | Open **Needs you** in the review UI, or run `checkmate inbox`. [Answer a gap](docs/local-qa.md#answer-a-gap-and-continue)                            |
| Running Checkmate in CI           | Run `checkmate test` on each build. Fail the job with `checkmate run show <runId> --gate`. [Pipeline](docs/factory.md#one-shot-qa-with-a-stored-run) |
| Testing a system you cannot reset | Set up with `--data isolation --policy-file <file>`. [Data kinds](docs/factory.md#data-kinds-prepare-and-cleanup)                                    |
| A contributor                     | Run `npm ci`, then `npm run phase:verify`. [Develop](docs/development.md)                                                                            |

Every command and state: [CLI and record reference](docs/reference.md).

## License

[MIT](LICENSE)
