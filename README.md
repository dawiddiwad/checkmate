#### □ □ ■ □

## _Checkmate - QA workflows for Claude_

<img src="docs/img/onboarding.gif" alt="onboarding" width="50%"/>

#

Think of it like a QA contract for agent testing: Claude Code drives your running application with real tools, and Checkmate keeps the record strict. A plan maps each requirement to tests with explicit assertions or to an open question. A human answers what is unclear, approves the plan, and accepts the result. Every assertion result needs saved evidence. It aims to patch the gap between fully coded tests and freelance agent testing.

## Install

Checkmate needs Node.js 24.12.0 or later, because it uses `node:sqlite`. Browser tests use [Playwright CLI](plugin/references/browser.md).

Install the Claude Code plugin:

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

The plugin has no npm dependencies and no build step. It contains every command that the skills need.

Install the npm CLI for the terminal, CI, and the review UI:

```sh
npm i -g @xoxoai/checkmate
checkmate --help
```

You can also run it without an install: `npx @xoxoai/checkmate <command>`. The npm package contains the same plugin at the same version. It adds `delegate` and `ui`.

## Usage

This example tests a local checkout. Run the `checkmate` commands in the application workspace. Run the `/checkmate:` skills in Claude Code in the same workspace.

1. Set your name for the record:

   ```sh
   export CHECKMATE_ACTOR=qa-lead
   ```

2. Open a target and set it up:

   ```sh
   checkmate target open checkout-local --base-url http://127.0.0.1:4173 \
     --capabilities browser,http --operations read_catalog,create_fixture_order,apply_fixture_discount
   ```

   ```text
   /checkmate:setup checkout-local
   ```

   The skill checks the tools and the target, and saves profile `checkout-local@1`.

3. Open a plan and let Claude write it. `plan-request.json` has the objective, requirements, and source context ([example](docs/CONFIGURATION.md#plan-request)).

   ```sh
   checkmate plan open checkout --target checkout-local@1 < plan-request.json
   ```

   ```text
   /checkmate:plan checkout
   ```

   The result is `needs_decision` when a requirement is unclear. Each unclear item is an open blocking gap, for example `G1: Does the 40 percent promotion stack with the 20 PLN loyalty discount?`

4. Answer the gaps, and let Claude apply the decisions:

   ```sh
   checkmate gap answer checkout G1 --kind clarify --source decisions#promotion \
     --value "The promotion replaces the loyalty discount. The quote total is 240 PLN." \
     --rationale "Product owner decision."
   checkmate gap answer checkout G2 --kind defer \
     --value "Refunds are out of scope for this release." --rationale "Product owner decision."
   ```

   ```text
   /checkmate:revise checkout
   ```

5. Read and approve the new revision:

   ```sh
   checkmate plan show checkout@2 --fields readiness,assertions
   checkmate plan approve checkout@2 --rationale "Tests and assertions match the brief."
   ```

6. Execute the plan:

   ```text
   /checkmate:execute checkout@2, tests T1,T2,T3, build fixture-build-1, run ID run-1
   ```

   In the same session, the skill runs `checkmate run gate` and `checkmate run begin`. Then it records each assertion with evidence, closes each test, records findings, and finishes the run.

7. Review and accept the result:

   ```sh
   checkmate run show run-1
   checkmate result accept run-1 --rationale "The defect in T3 is real. Fix before release."
   ```

   You can also make every decision in the review UI:

   ```sh
   checkmate ui
   ```

### CI and scripts

`checkmate delegate` runs one stage in a fresh Claude Code session. Open the subject first, then delegate:

```sh
checkmate target open checkout-local --base-url "$BASE_URL" --capabilities browser,http \
  --operations read_catalog,create_fixture_order,apply_fixture_discount
checkmate delegate setup checkout-local --allow Read --allow Write --allow "Bash(node *)" --allow "Bash(playwright-cli *)"
checkmate plan open checkout --target checkout-local@1 < plan-request.json
checkmate delegate plan checkout --allow Read --allow Write --allow "Bash(node *)"
# A human answers the gaps and approves checkout@2.
checkmate run begin run-7 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-7 --allow Read --allow Write --allow "Bash(node *)" --allow "Bash(playwright-cli *)"
```

The parent does not trust the worker's words. It reads the database and returns the recorded result. Read [CLI](docs/CLI.md) for the stages, permissions, and deadlines.

### Example artifacts

These files were exported from a live run with Claude Code on the local checkout fixture:

- Plans: [revision 1](docs/examples/plans/checkout-v1.md) with two open gaps, and [revision 2](docs/examples/plans/checkout-v2.md) after the decisions.
- Runs: [live-run](docs/examples/runs/live-run.md) found a defect in T3. [live-retest](docs/examples/runs/live-retest.md) passed on a new build.

Read [the examples index](docs/examples/README.md) for the HTML and JSON forms.

## How it works

![Checkmate overview: five stages, a checkout example with a defect found and a passed retest, and who owns what.](docs/img/checkmate-infographic.png)

The image shows the workflow stages: setup, plan, revise, execute, and report.

- **One SQLite store.** Checkmate keeps targets, plans, decisions, approvals, runs, evidence, and an operation log in `.checkmate/checkmate.db`. Rows do not change after a write. A plan revision and a result are snapshots with a SHA-256 digest. Each command records who did what, and when.
- **Assertions.** Each test has one action and a list of assertions. The agent records each assertion as `passed`, `failed`, `inconclusive`, or `not_checked`, with an observation and evidence. Checkmate calculates the test outcome. One failed assertion fails the test. An `inconclusive` assertion means that the evidence cannot show the answer. An inconclusive test does not cover its requirement. Read [Evidence](docs/EVIDENCE.md) for the complete rule.
- **Human gate.** A human approves a plan revision before execution and accepts a result after execution. A new revision needs a new approval. The target profile can turn off each gate.
- **Review UI.** `checkmate ui` starts a local server on `127.0.0.1`. The inbox shows the gaps to answer, the plans to approve, and the results to accept. Pages update live when the CLI or a Claude session writes to the database. The UI uses the same functions as the CLI.
- **Resumable runs.** An assertion result is final when the agent records it. After a crash or a deadline, `checkmate run resume` lists the open work. A retest is a new run on a new build. The prior run does not change.

Completion, test outcomes, and coverage are separate fields. A process exit code is not a release decision. Checkmate checks structure and relationships. It cannot prove that an observation is true. Claude Code owns the model, authentication, tools, and permissions.

## Commands

| Commands                                                                                                | Purpose                           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `init`                                                                                                  | Create the database.              |
| `target open`, `target request`, `target save`, `target show`                                           | Record and read target profiles.  |
| `plan open`, `plan request`, `plan save`                                                                | Create a plan.                    |
| `plan show`, `plan list`, `plan diff`                                                                   | Read plans.                       |
| `gap answer`, `plan pending`, `plan revise`                                                             | Decide and revise.                |
| `plan approve`, `plan reject`                                                                           | Plan gate.                        |
| `run gate`, `run begin`, `run check`, `run close`, `run finding`, `run gap`, `run finish`, `run resume` | Execute.                          |
| `run show`, `run list`                                                                                  | Read runs.                        |
| `result accept`, `result reject`                                                                        | Result gate.                      |
| `evidence get`, `export plan`, `export run`                                                             | Read evidence and export reports. |
| `log`, `query`                                                                                          | Operation log and read-only SQL.  |
| `delegate`, `ui`                                                                                        | npm CLI only: workers and the UI. |

Put options after the command, for example `checkmate plan list --workspace ../app`. Run `checkmate --help` for every option. In a plugin session, the skills run `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`.

## Docs

[Configuration and payloads](docs/CONFIGURATION.md)  
[CLI](docs/CLI.md)  
[Evidence and outcomes](docs/EVIDENCE.md)  
[Validation](docs/VALIDATION.md)  
[Examples](docs/examples/README.md)  
[Dev](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE)
