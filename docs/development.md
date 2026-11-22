# Development

> **Guide** · For people who change Checkmate itself: the layout, the checks, the release flow, and the media of this manual.

The plugin is plain TypeScript that Node.js runs directly, with no runtime npm dependencies. Every change goes through `npm run phase:verify`, and a merged pull request releases itself.

**On this page:** [Set up](#set-up) · [Layout](#layout) · [Checks](#checks) · [Writing tests](#writing-tests) · [Contracts](#contracts) · [Releases](#releases) · [Media](#media)

## Set up

1. Use Node.js 24.12.0 or later.
2. Install the pinned development dependencies with `npm ci`.
3. Make your change on a feature branch.
4. Install Pi and set `CHECKMATE_BROWSER_EXECUTABLE` to a Chromium executable.
5. Run `npm run phase:verify`.

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
- `cli/` runs `scripts/build-cli.ts` before it packs. The script bundles `cli/src/main.ts` and copies `plugin/`, `README.md`, and `LICENSE` into the package. In the package README, relative links and images point to the release tag on GitHub.
- The plugin uses the installed Claude Code CLI. Do not add a model loop or an Agent SDK runner. Keep model selection, authentication, and permissions with the host.

## Checks

Install the pinned Pi CLI and choose a Chromium executable. For example, on macOS:

```sh
npm install -g @earendil-works/pi-coding-agent@1.5.2
export CHECKMATE_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
npm run phase:verify
```

On Linux, set `CHECKMATE_BROWSER_EXECUTABLE` to the path of Chromium or Chrome. `npm test` builds and packs the CLI, then runs 34 required cases with real SQLite, loopback apps, controlled hosts, Pi, and Chromium. It fails when a prerequisite or required case is missing, or when a case skips. `phase:verify` runs type, lint, and format checks before that suite. CI and release candidate verification run the same command once.

Read `test/e2e/scenarios.json` for the 42 proposal scenarios and their current coverage or limits. The historical self-Factory campaign runner is absent. The external Factory fixture does not prove its checkout, archive, verification, or budget ownership. Controlled hosts and the local Pi provider do not prove live model judgment. No authenticated or paid run is part of this suite.

## Writing tests

Use these rules when you add or change a test.

1. Start with a public command or review UI flow. Use the installed package when packaging affects behavior.
2. Name the failure each case detects. Keep assertions about persisted state, evidence, and user-visible outcomes.
3. Use disposable workspaces, real SQLite, and loopback apps when the workflow crosses those boundaries.
4. Control hosts and external services. Check what they receive and what the product records. Do not claim that a replay proves model judgment.
5. Add focused invariant checks when a distinct failure needs them. Avoid repeating the same behavior across layers.
6. Update the scenario catalog and the expected case count when the suite changes. Do not allow required cases to skip.

## Local packaged QA quickstart

Run `npm test` with Pi and Chromium configured as shown above. The suite installs the npm artifact in temporary workspaces. A loopback checkout returns 220 PLN for the broken build and 240 PLN after the fix. A controlled Pi process reads the response and the oracle answer. The scenario checks the defect, evidence, blocking question, retest, and cleanup. It does not need provider credentials and does not measure live model judgment.

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

`scripts/ui-screenshots.ts` seeds a temporary demo workspace and captures the review UI in light and dark themes. It writes PNG files to the output directory:

```sh
CHECKMATE_BROWSER_EXECUTABLE=/usr/bin/google-chrome node scripts/ui-screenshots.ts /tmp/shots
```

Add alt text when you publish an image.

### Examples

`docs/examples/` holds exports from a live run. Do not edit them by hand. Read [Examples](examples/README.md).

## Next

- [Concepts](reference/concepts.md): the terms that the code and the manual share.
- [The record](reference/record.md): the rules that the store tests check.
