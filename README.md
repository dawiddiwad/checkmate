#### □ □ ■ □

# Checkmate

### The QA system of record for an agent software factory.

Checkmate turns a ticket into tests. It records each run, its evidence, open questions, and oracle decisions in one local SQLite record. Agents and people use the same record.

The recording runs the real CLI against a demo shop. A ticket becomes a plan, the gaps are answered, and a run finds a defect and gates the result. The last scenes show the review UI.

[![A terminal walkthrough of a ticket becoming a plan with two gaps, the answers and a revision, a run where one child tests each test and finds a defect, and the gate. The final scenes show the review UI: the home page, the plan, the run with its defect, the built-in chat that answers and records a decision, the model picker, and the status.](docs/img/onboarding.gif)](docs/img/onboarding.gif)

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

The planner defines tests. QA runs them on a named build. The oracle answers gaps, approves plans, and accepts recorded results. The factory builds and fixes the application.

| You are                                             | Do this                                                                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A developer who tests a change locally              | Run `npx checkmate ui` in the project, then choose **New change**. See [Local QA](docs/local-qa.md).                                                                                                                         |
| An oracle who answers gaps and accepts results      | Run `checkmate inbox`, then `checkmate status <planId>`. See [Answer a gap](docs/local-qa.md#answer-a-gap-and-continue).                                                                                                     |
| A Claude Code user                                  | Run `/plugin marketplace add dawiddiwad/checkmate`, then `/plugin install checkmate@checkmate`. Then use `/checkmate:test`. See [Use a host plugin](docs/start.md#use-a-host-plugin).                                        |
| A Pi user                                           | Run `pi install npm:@xoxoai/checkmate -l` in the project, then `/checkmate <objective>`. See [Use a host plugin](docs/start.md#use-a-host-plugin).                                                                           |
| A team that runs Checkmate unattended in a pipeline | Run `checkmate test` on one build, then gate the run with `checkmate run show <runId> --gate`. See [One-shot QA](docs/factory.md#one-shot-qa-with-a-stored-run) and [exit codes](docs/factory.md#exit-codes-for-a-pipeline). |
| Someone who tests a system that cannot be reset     | Give the data kind at setup: `--data isolation --policy-file <file>`. See [Data kinds](docs/factory.md#data-kinds-prepare-and-cleanup).                                                                                      |
| Anyone who needs a command, state, or contract      | Run `checkmate --help`. See [CLI and record reference](docs/reference.md).                                                                                                                                                   |
| A contributor                                       | Install Pi and Chromium, then run `npm ci` and `npm run phase:verify`. See [Develop Checkmate](docs/development.md).                                                                                                         |

## License

[MIT](LICENSE)
