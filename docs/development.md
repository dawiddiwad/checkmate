# Development

> **Guide** · For people who change Checkmate itself: the layout, the checks, the release flow, and the media of this manual.

The plugin is plain TypeScript that Node.js runs directly, with no runtime npm dependencies. Every change goes through `npm run phase:verify`, and a merged pull request releases itself.

**On this page:** [Set up](#set-up) · [Layout](#layout) · [Checks](#checks) · [Writing tests](#writing-tests) · [Live tests](#live-tests) · [Plugin evals](#plugin-evals) · [Contracts](#contracts) · [Releases](#releases) · [Media](#media)

## Set up

1. Use Node.js 24.12.0 or later.
2. Install the pinned development dependencies with `npm ci`.
3. Make your change on a feature branch.
4. Run `npm run phase:verify`.

## Layout

| Path                 | Holds                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `plugin/`            | The Claude Code plugin. Claude Code copies only this directory. It runs no npm install.                                        |
| `plugin/skills/`     | The test, setup, plan, revise, execute, report, status, and ui skills.                                                         |
| `plugin/references/` | `workflow.md` with the stage rules, `session.md` with the same-session rules, and the tool recipes `browser.md` and `http.md`. |
| `plugin/contracts/`  | The JSON Schemas. They are the authority.                                                                                      |
| `plugin/src/`        | The store, the rules, the commands, the views, the exports, and the review UI.                                                 |
| `plugin/dist/`       | `checkmate.js`, the bundle of `plugin/bin/checkmate.ts`.                                                                       |
| `cli/`               | The npm package `@xoxoai/checkmate`. It adds `delegate`.                                                                       |
| `scripts/`           | Generators, build scripts, the release script, and the media scripts.                                                          |
| `test/`              | The tests. They are TypeScript and run directly with `node --test`.                                                            |

- The plugin imports only Node.js built-in modules and its own files. Do not add runtime npm dependencies.
- The runtime uses erasable TypeScript syntax, so Node.js runs `plugin/bin/checkmate.ts` without a compiler.
- Node.js does not strip types in `node_modules`, so the npm package runs the JavaScript bundle.
- The root package is private. It holds the development dependencies and commands.
- `cli/` runs `scripts/build-cli.ts` before it packs. The script bundles `cli/src/main.ts` and copies `plugin/` without `plugin/evals/`, `README.md`, and `LICENSE` into the package. In the package README, relative links and images point to the release tag on GitHub.
- The plugin uses the installed Claude Code CLI. Do not add a model loop or an Agent SDK runner. Keep model selection, authentication, and permissions with the host.

## Checks

```sh
npm run phase:verify
```

`phase:verify` runs, in order:

1. `type:check`: the generated types, validators, and plugin bundle match their sources, and TypeScript has no errors.
2. `lint:check`: ESLint on `plugin`, `cli`, `scripts`, and `test`.
3. `format:check`: Prettier.
4. `npm test`: runs `node --test test/*.test.ts`. It uses temporary workspaces and needs no network or Claude credential. It includes browser suites; those suites skip when `CHECKMATE_BROWSER_EXECUTABLE` is unset.
5. `node test/plugin.ts`: copies `plugin/` out of the repository and runs the bundled CLI without npm install.

The verify job in CI also runs `npm run test:tools` as a separate step after `phase:verify`. `test:tools` runs `test/tools.ts`: a real browser through Playwright CLI and the HTTP API against the checkout fixture. It is not in `npm test`, because it tests the fixture and Playwright CLI, not Checkmate. Run it when you change `test/fixture.ts`, the Playwright CLI version, or `plugin/references/browser.md`.

Browser tests need Chromium. Set `CHECKMATE_BROWSER_EXECUTABLE` to its path to run them. CI sets this variable. Without it, browser cases in `npm test` skip. `npm run test:tools` also needs Chromium. On a restricted Linux filesystem, set `XDG_CACHE_HOME` to a writable directory.

| Selected test file               | Covers                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `test/store.test.ts`             | Schema, version check, triggers, foreign keys, WAL readers, lock errors, canonical JSON, ULIDs.               |
| `test/targets.test.ts`           | Setup requests, profile checks, revision order, the default approval policy.                                  |
| `test/plans.test.ts`             | Plan rules, decisions, delta revise, concurrent revise, patch edits, approval, gate reasons.                  |
| `test/cross-plan.test.ts`        | Cross-plan references, cycles, blocks by result, acceptance, and open gaps in other plans.                    |
| `test/runs.test.ts`              | Outcomes, checks, closes, findings, runtime gaps, finish rules, coverage, resume, retest.                     |
| `test/evidence.test.ts`          | Blob deduplication, file deletion, equal bytes on read, path containment, the 32 MiB limit.                   |
| `test/views.test.ts`             | The inbox, the approval policy, the loop state, and the plan, run, and log lists.                             |
| `test/render.test.ts`            | HTML, Markdown, and JSON exports.                                                                             |
| `test/cli.test.ts`               | Output, flags, read-only `query`, actor, standard input, log cursor, parallel writers, export.                |
| `test/launcher.test.ts`          | `delegate` with a fake Claude CLI: worker output, checks, `--claude-arg`, deadlines, cleanup.                 |
| `test/hook.test.ts`              | The oracle signal hook and settings from the factory guide, with fake payloads and a webhook.                 |
| `test/package.test.ts`           | `npm pack` and install of the CLI, delegated spec review, permanent-only run, and local app QA.               |
| `test/spec.test.ts`              | Specification review and handoff, followed by a loopback run, retest, and promotion.                          |
| `test/promotion.test.ts`         | Promotion requirements and refusals, including snapshots and acceptance.                                      |
| `test/qa-status.test.ts`         | Same-build follow recommendations shared by the CLI and review page.                                          |
| `test/release.test.ts`           | Version rules and the five version files.                                                                     |
| `test/ui.test.ts`                | UI pages, escaping, forms, stale digests, Host and Origin checks, live events, lists, edits.                  |
| `test/ui.browser.test.ts`        | The UI in a real browser: keyboard, focus, forms, the editor, and no JavaScript.                              |
| `test/ui.pages.browser.test.ts`  | The UI in a real browser: live updates, lists, history, downloads, Settings, dark mode, and page width.       |
| `test/ui.review.test.ts`         | The plan review on the volume seed: views, records, options, hand-over, bulk, find, evidence, status path.    |
| `test/ui.review.browser.test.ts` | The plan review in a real browser: the key model, Down then 1, history, selection, areas, bars, mouse.        |
| `test/ui.layout.browser.test.ts` | Alignment, contrast, overflow, and tap targets at 1440, 900, and 400 px in both themes and the fallback font. |

Add tests for changed relationships and failure paths. Do not replace browser or live checks with mocked success.

## Writing tests

Use these rules when you add or change a test.

1. **Assert a rule once.** Assert it at the lowest layer that owns it, for example `plans`, `runs`, or `views`. A CLI, UI, or browser test checks only the wiring: one happy path and one refusal for each command or page.
2. **Write one scenario for each feature and for each escaped bug.** At each step, check `state`, `waitsOn`, `why`, and `next`. Name the test after the behavior that broke.
3. **Use a table for validation.** Write one test for each input surface, with a table of inputs and expected reasons. Do not add a test for each bad input.
4. **Write one property test for each state machine.** Check invariants at each step, not only that the walk ends.
5. **Assert behavior, not text.** The agent-facing CLI lines are a contract. Check the format of each command in one test. In other places, match the identifying tokens, for example `/Unknown test .*T9/`. Select HTML by `data-key`, role, or label, not by class names or markup.
6. **Keep a runtime budget, not a count budget.** Do not use a fixed wait. Wait for a condition, or inject the timeout. Use a subprocess only when the proof needs a process boundary, for example standard input, an exit code, or a lock between processes. Use a browser only for client behavior. Seed a shared workspace once for each file, and copy it for each test.

## Local packaged QA quickstart

1. Use Node.js 24.12.0 or later.
2. Run `npm ci` in the repository.
3. Run `node --test test/package.test.ts`.

The test builds and packs the npm CLI. It installs the tarball in a temporary workspace. It starts the disposable checkout app on a loopback port. A scripted Pi process reads the app response and the recorded oracle answer. It needs no model, provider credentials, or browser.

The output names three explorations. The broken build returns 220 PLN and records a defect, evidence, and a blocking question. A fixed build returns 240 PLN, but the replay does not pass the rule before the answer. The test records the oracle answer with `checkmate gap answer`, then tests the fixed build again. It checks the passing rule, the fixed verdict, and the earlier evidence. It checks that the app and worker processes exit. Temporary workspaces are removed after the test.

This replay checks the package and record flow. It does not measure the judgment of a live model or prove that a real host follows the workflow.

## Pi integration test

Install Pi on your path and run `npm run test:pi`. This CI check installs the package from an isolated Git repository and opens the review UI in a clean workspace. It also checks recorded operations with the real Pi CLI and a local model fixture. It requires no provider key.

## Live tests

```sh
npm run test:live
```

`test:live` runs `test/live.ts` and `test/live-session.ts` with a real Claude Code CLI against the local checkout fixture.

- Claude Code CLI: the tests use the `claude` command on the `PATH`. It is not a development dependency. The live job in CI installs a pinned version.
- Authentication: set `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `CHECKMATE_USE_HOST_LOGIN=1` for an existing host login. With a token, the test uses a temporary `CLAUDE_CONFIG_DIR`. Without authentication, the test fails. It does not skip.
- Model: the test sets `ANTHROPIC_MODEL` to `claude-haiku-5-5` when it is not set. A delegated stage gets no model from Checkmate.
- Permissions: the workers get `Read` and `Bash` in a temporary workspace.
- `test/live.ts` checks delegated setup, planning gaps, decisions, revision, approval, execution with a defect, acceptance, a retest, and a plan skill in one session. `test/live-session.ts` checks execution in one session and a permission denial.
- Each test prints the stage, duration, and status, and writes `measurements.json` in the workspace. The workspace stays, and its path is printed.

A passed live run does not prove that a worker always follows the skills. [Examples](examples/README.md) records the latest published run.

## Plugin evals

`plugin/evals/` holds a small suite for `claude plugin eval`. Each case is a folder with `prompt.md`, `case.yaml`, `scaffold.sh`, and `graders/*.md`. `plugin/evals/lib/workspace.sh` makes the workspace of a case: a ticket, product documentation, a small file-based inventory app, and the Checkmate records that the case needs.

| Case                      | Checks                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sandbox-probe`           | The shell can write in the workspace and open a SQLite database in WAL mode. Run it first.                        |
| `plan-trigger`            | A request to plan tests for a ticket loads `checkmate:plan`.                                                      |
| `retest-trigger`          | A request to retest a run loads `checkmate:execute` and begins a run with `--retest-of`.                          |
| `test-trigger-*`          | Five plain requests to test a change load `checkmate:test`, not `checkmate:plan`.                                 |
| `plan-trigger-*`          | Three requests for a test plan, test cases, or a requirements review load `checkmate:plan`, not `checkmate:test`. |
| `status-trigger`          | A question about the state of a plan loads `checkmate:status` and changes no record.                              |
| `plan-vague-terms`        | A vague threshold and a vague scope word each give an open gap, and no gap asks what a source answers.            |
| `plan-edge-cases`         | The saved plan has independent tests and edge-case tests at and near the restock level.                           |
| `plan-regression-sources` | A regression test checks a rule that the docs state, and no assertion invents a value.                            |
| `execute-missing-tool`    | A test that needs a missing tool is closed, the other tests run, and `run finish` ends the run.                   |
| `execute-refusal-retry`   | A refused `run finish` makes QA record the missing defect and finish again.                                       |
| `ask-first-run`           | A first run on a URL that is not local asks the environment and the data rule in one `AskUserQuestion` call.      |
| `ask-from-agent`          | A task from an agent does not use `AskUserQuestion`. The reply gives the question as text or `needs_decision`.    |

Run the suite from the repository root:

```sh
claude plugin eval plugin --case sandbox-probe --runs 1 --scaffold --trust-plugin --allow-tools Bash Read Write Edit --no-publish
claude plugin eval plugin --scaffold --trust-plugin --allow-tools Bash Read Write Edit --keep-temp \
  --model claude-haiku-5-5 --judge-model claude-haiku-5-5 --max-cost-usd 20 --no-publish
```

- The suite calls a real model. Each case runs 3 times with the plugin and 3 times without it, and `sandbox-probe` once in each arm, so one full run is 110 agent sessions and the LLM graders. It costs money on your credential. Set `--max-cost-usd`, and use `--case <glob>` or `--tag trigger` for a smaller run.
- Run `sandbox-probe` first. Do not trust the other cases until it passes. With only `Bash Read`, the eval sandbox mounts the workspace read-only, and every Checkmate command fails with `unable to open database file`.
- `--keep-temp` keeps the workspace of each case, so you can read the trace of a case without an LLM grader.
- `--scaffold` runs `scaffold.sh` of each case as you. The scaffold writes only in the temporary workspace of the case.
- The scaffold finds the plugin CLI through `CLAUDE_PLUGIN_ROOT`, else through its own path in `plugin/evals/`.
- The results go to `plugin/evals/results/`. Git ignores them.
- The suite is not part of `phase:verify` or CI. A passed suite does not prove that a worker always follows the skills.
- The marketplace plugin contains `plugin/evals/`. The npm package does not: `scripts/build-cli.ts` leaves it out of the plugin copy.

## Contracts

1. Edit the schemas in `plugin/contracts/`.
2. Run `npm run generate`. It writes `plugin/src/types.ts` and `plugin/src/validators.js`.
3. Do not edit the generated files. `npm run type:check` fails when they differ from the schemas.
4. Update the skills and this manual.

The plan candidate validator is the plan schema without `coverage`. The generator derives it, so it has no schema file.

The design record of the store and the review UI is `.agents/wiki/sqlite-store-design.md`. It explains the decisions behind the schema. When it differs from the code, the code and the schemas win.

## Releases

Each merged pull request to `main` starts the release job in `.github/workflows/ci.yml` after `verify` passes.

1. `scripts/release-version.ts` checks that the five version files agree: `package.json`, `package-lock.json`, `cli/package.json`, `plugin/.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
2. When the current version already has a tag, it increases the patch version in all five files.
3. The job runs `phase:verify` on the release candidate.
4. It pushes the version commit and the tag `v<version>`.
5. It publishes `./cli` to npm with trusted publishing. No npm token is used.
6. After the publish succeeds, it creates the GitHub release.

- **No release.** Add the `skip-release` label to the pull request before you merge it.
- **Minor or major.** Set the new version in all five files in the pull request. It must be newer than every release tag, and npm must not have it yet.
- **Resume.** Release jobs run one at a time. When a job fails after the push, rerun the failed job. Or run CI manually on `main` with `release` on and the merged pull request number in `pull_request`. The job reuses the release commit and tag, and skips the npm publish when npm already has the version.
- **Manual release.** A manual run does not check the labels. Without a pull request number, it makes a separate release. A direct push without a merged pull request does not release.
- **Live job.** The live job runs only when you select `live` in a manual run. It needs the repository secret `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. Do not expose secrets to untrusted pull requests.

npm must trust this repository and `.github/workflows/ci.yml`. The workflow token needs write access to the contents, and the repository rules must let the release bot push the commit and the tag.

## Media

The manual uses three kinds of media, all dark. The animation and the diagrams share the tokens in `docs/media/style.css` and the fonts of the manual in `docs/media/fonts/`.

### Onboarding animation

`docs/img/onboarding.gif` comes from `docs/media/onboarding.html`, with the arrows from `docs/media/swimlane.js`. The animation is 900 by 756 pixels.

- The top band is a ring: the planner and the oracle on the top edge, the factory and QA on the bottom edge, the record in the centre, and the human badge below. The amber path on the left goes from QA back to the planner.
- The lower band is a swimlane: one lane for each role, the record lane at the bottom, and time from left to right. A dashed step in the oracle lane is a human in the review UI.
- Each step and record has `data-t`, the second when it appears. Each caption has `data-from` and `data-to`. A step with `data-station` lights that station. `pans` moves the track, and `window.DURATION` is the total.
- Give each scene 4 to 6 seconds. Keep one idea in each scene and the scenes flat, so the GIF stays under 1 MB.
- Use the terms of this manual, for example "oracle". The animation is an illustration, not a test recording.

Render it with Chromium and FFmpeg installed:

```sh
node scripts/render-onboarding.ts
```

Set `CHECKMATE_BROWSER_EXECUTABLE` when Chromium is not at `/usr/bin/chromium`. Prettier does not format `docs/media/*.html`, because their text keeps exact whitespace.

### Diagrams

`docs/media/diagrams.html` holds three static figures, 900 pixels wide. Each `<figure>` becomes `docs/img/<id>.png` at twice that size:

- `roles.png`: the four roles around the record. [Concepts](reference/concepts.md) shows it.
- `life.png`: the loop states of one plan and the next step of each. [Run Checkmate from a factory](guides/factory.md) shows it.
- `run.png`: the record of one run and the four separate answers. [Runs and evidence](reference/runs.md) shows it.

Use the terms of the manual and values that a real run prints, for example the states that `checkmate status` prints. Render all three with Chromium installed:

```sh
node scripts/render-diagrams.ts
```

### Review UI on a volume of data

`scripts/ui-volume.ts` fills a new workspace with a realistic volume: 5 plans, 10 explorations (one running, one paused, one failed), 60 claims in all states with steps and evidence, 81 merged questions, 3 runs, and their operations. It uses only the store functions and starts no model. Open the UI on it with one command:

```sh
npm run ui:volume
```

The command prints the URL. Ctrl+C stops the UI and its sample process, then deletes the workspace. To keep the workspace, run `node scripts/ui-volume.ts --seed <folder>`. Then run `checkmate ui --workspace <folder>`.

### Review UI screenshots

`scripts/ui-demo.ts` seeds a demo workspace. `npm run ui:volume` seeds a large workspace, with a plan of 50 rules in 9 areas over three builds, and starts the UI on it. `scripts/ui-screenshots.ts` captures it in PNG. The manual uses the dark captures as JPEG files, 1280 pixels wide, in `docs/img/ui/`:

```sh
CHECKMATE_BROWSER_EXECUTABLE=/usr/bin/google-chrome node scripts/ui-screenshots.ts /tmp/shots
for name in inbox plans plan run-gap settings-target; do
  convert /tmp/shots/$name-dark.png -resize 1280x -quality 82 docs/img/ui/$name.jpg
done
```

Give each image alt text that says what it shows.

### Examples

`docs/examples/` holds exports from a live run. Do not edit them by hand. Read [Examples](examples/README.md).

## Next

- [Concepts](reference/concepts.md): the terms that the code and the manual share.
- [The record](reference/record.md): the rules that the store tests check.
