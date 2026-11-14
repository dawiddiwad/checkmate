# Development

> **Guide** · For people who change Checkmate itself: the layout, the checks, the release flow, and the media of this manual.

The plugin is plain TypeScript that Node.js runs directly, with no runtime npm dependencies. Every change goes through `npm run phase:verify`, and a merged pull request releases itself.

**On this page:** [Set up](#set-up) · [Layout](#layout) · [Checks](#checks) · [Live tests](#live-tests) · [Contracts](#contracts) · [Releases](#releases) · [Media](#media)

## Set up

1. Use Node.js 24.12.0 or later.
2. Install the pinned development dependencies with `npm ci`.
3. Make your change on a feature branch.
4. Run `npm run phase:verify`.

## Layout

| Path                 | Holds                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `plugin/`            | The Claude Code plugin. Claude Code copies only this directory. It runs no npm install.     |
| `plugin/skills/`     | The setup, plan, revise, execute, report, status, and ui skills.                            |
| `plugin/references/` | `workflow.md` with the shared stage rules, and the tool recipes `browser.md` and `http.md`. |
| `plugin/contracts/`  | The JSON Schemas. They are the authority.                                                   |
| `plugin/src/`        | The store, the rules, the commands, the views, the exports, and the review UI.              |
| `plugin/dist/`       | `checkmate.js`, the bundle of `plugin/bin/checkmate.ts`.                                    |
| `cli/`               | The npm package `@xoxoai/checkmate`. It adds `delegate`.                                    |
| `scripts/`           | Generators, build scripts, the release script, and the media scripts.                       |
| `test/`              | The tests. They are TypeScript and run directly with `node --test`.                         |

- The plugin imports only Node.js built-in modules and its own files. Do not add runtime npm dependencies.
- The runtime uses erasable TypeScript syntax, so Node.js runs `plugin/bin/checkmate.ts` without a compiler.
- Node.js does not strip types in `node_modules`, so the npm package runs the JavaScript bundle.
- The root package is private. It holds the development dependencies and commands.
- `cli/` runs `scripts/build-cli.ts` before it packs. The script bundles `cli/src/main.ts` and copies `plugin/`, `README.md`, and `LICENSE` into the package. In the package README, relative links and images point to the release tag on GitHub.
- The plugin uses the installed Claude Code CLI. Do not add a model loop or an Agent SDK runner. Keep model selection, authentication, and permissions with the host.

## Checks

```sh
npm run phase:verify
```

`phase:verify` runs, in order:

1. `type:check`: the generated types, validators, and plugin bundle match their sources, and TypeScript has no errors.
2. `lint:check`: ESLint on `plugin`, `cli`, `scripts`, and `test`.
3. `format:check`: Prettier.
4. `npm test`: the fast suite. It uses temporary workspaces and needs no network and no Claude credential.
5. `node test/plugin.ts`: copies `plugin/` out of the repository and runs the bundled CLI without npm install.

The browser tests need Chromium. Set `CHECKMATE_BROWSER_EXECUTABLE` when it is not `/usr/bin/chromium`. On a restricted Linux filesystem, set `XDG_CACHE_HOME` to a writable directory.

| Test file                 | Covers                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `test/store.test.ts`      | Schema, version check, immutability triggers, foreign keys, WAL readers, canonical JSON, ULIDs. |
| `test/targets.test.ts`    | Setup requests, profile checks, revision order, the default approval policy.                    |
| `test/plans.test.ts`      | Plan rules, decisions, delta revise, concurrent revise, patch edits, approval, gate reasons.    |
| `test/cross-plan.test.ts` | Cross-plan references, cycles, blocks by result, acceptance, and open gaps in other plans.      |
| `test/runs.test.ts`       | Outcomes, checks, closes, findings, runtime gaps, finish rules, coverage, resume, retest.       |
| `test/evidence.test.ts`   | Blob deduplication, file deletion, equal bytes on read, path containment, the 32 MiB limit.     |
| `test/views.test.ts`      | The inbox, the approval policy, the loop state, and the plan, run, and log lists.               |
| `test/render.test.ts`     | HTML, Markdown, and JSON exports.                                                               |
| `test/cli.test.ts`        | Compact and JSON output, flags, read-only `query`, actor, standard input, log, export.          |
| `test/launcher.test.ts`   | `delegate` with a fake Claude CLI: worker output, database checks, deadlines, browser cleanup.  |
| `test/tools.test.ts`      | A real browser and HTTP API against the checkout fixture.                                       |
| `test/package.test.ts`    | `npm pack` and install of the CLI, the package README links, and `delegate` with the plugin.    |
| `test/release.test.ts`    | Version rules and the five version files.                                                       |
| `test/ui.test.ts`         | UI pages, escaping, forms, stale digests, Host and Origin checks, live events, lists, edits.    |
| `test/ui.browser.test.ts` | The UI in a real browser: keyboard, forms, live updates, dark mode, and no JavaScript.          |

Add tests for changed relationships and failure paths. Do not replace browser or live checks with mocked success.

## Live tests

```sh
npm run test:live
```

`test:live` runs `test/live.ts` and `test/live-session.ts` with a real Claude Code CLI against the local checkout fixture.

- Authentication: set `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `CHECKMATE_USE_HOST_LOGIN=1` for an existing host login. With a token, the test uses a temporary `CLAUDE_CONFIG_DIR`. Without authentication, the test fails. It does not skip.
- Model: the test sets `ANTHROPIC_MODEL` to `claude-haiku-5-5` when it is not set. Checkmate does not select a model.
- Permissions: the workers get `Read` and `Bash` in a temporary workspace.
- `test/live.ts` checks delegated setup, planning gaps, decisions, revision, approval, execution with a defect, acceptance, a retest, and a plan skill in one session. `test/live-session.ts` checks execution in one session and a permission denial.
- Each test prints the stage, duration, and status, and writes `measurements.json` in the workspace. The workspace stays, and its path is printed.

A passed live run does not prove that a worker always follows the skills. [Examples](examples/README.md) records the latest published run.

## Contracts

1. Edit the schemas in `plugin/contracts/`.
2. Run `npm run generate`. It writes `plugin/src/types.ts` and `plugin/src/validators.js`.
3. Do not edit the generated files. `npm run type:check` fails when they differ from the schemas.
4. Update the skills and this manual.

The plan candidate validator is the plan schema without `coverage`. The generator derives it, so it has no schema file.

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

The manual uses two kinds of media, both dark.

### Onboarding animation

`docs/img/onboarding.gif` comes from `docs/media/onboarding.html`, with the tokens in `docs/media/style.css` and the arrows from `docs/media/swimlane.js`. The animation is 900 by 756 pixels.

- The top band is a ring: the planner and the oracle on the top edge, the factory and QA on the bottom edge, the record in the centre, and the human badge below. The amber path on the left goes from QA back to the planner.
- The lower band is a swimlane: one lane for each role, the record lane at the bottom, and time from left to right. A dashed step in the oracle lane is a human in the review UI.
- Each step and record has `data-t`, the second when it appears. Each caption has `data-from` and `data-to`. A step with `data-station` lights that station. `pans` moves the track, and `window.DURATION` is the total.
- Give each scene 4 to 6 seconds. Keep one idea in each scene and the scenes flat, so the GIF stays under 1 MB.
- Use the terms of this manual, for example "oracle". The animation is an illustration, not a test recording.

Render it with Chromium and FFmpeg installed:

```sh
node scripts/render-onboarding.ts
```

Set `CHECKMATE_BROWSER_EXECUTABLE` when Chromium is not at `/usr/bin/chromium`. The page loads its fonts from `plugin/src/ui/assets/fonts/`. Prettier does not format these pages, because their text keeps exact whitespace.

### Review UI screenshots

`scripts/ui-demo.ts` seeds a demo workspace. `scripts/ui-screenshots.ts` captures it in PNG. The manual uses the dark captures as JPEG files, 1280 pixels wide, in `docs/img/ui/`:

```sh
CHECKMATE_BROWSER_EXECUTABLE=/usr/bin/google-chrome node scripts/ui-screenshots.ts /tmp/shots
for name in inbox plans plan run-gap run; do
  convert /tmp/shots/$name-dark.png -resize 1280x -quality 82 docs/img/ui/$name.jpg
done
```

Give each image alt text that says what it shows.

### Examples

`docs/examples/` holds exports from a live run. Do not edit them by hand. Read [Examples](examples/README.md).

## Next

- [Concepts](reference/concepts.md): the terms that the code and the manual share.
- [The record](reference/record.md): the rules that the store tests check.
