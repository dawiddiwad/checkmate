# Development

Use the existing checkout. Cloud tasks already have an isolated workspace. Create a worktree only on request.

Use Node.js 24.12.0 or later. Install pinned dependencies with `npm ci`. Use a separate feature branch for changes.

```sh
npm run phase:verify
npm run test:live
```

`phase:verify` checks types, lint, formatting, contracts, launcher failures, the npm package install, release version updates, and a clean plugin install. It does not need a Claude credential.

The browser test requires a Chromium executable. Set `CHECKMATE_BROWSER_EXECUTABLE` when it is not `/usr/bin/chromium`. On a restricted Linux filesystem, set `XDG_CACHE_HOME` to a writable cache directory.

`test:live` requires an authenticated Claude Code CLI. Set `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `CHECKMATE_USE_HOST_LOGIN=1` for an existing host login. With a token and without `CHECKMATE_USE_HOST_LOGIN=1`, the test uses a temporary `CLAUDE_CONFIG_DIR`. With a host login, it keeps the default configuration. The test fails when authentication is unavailable. It does not silently skip.

`test:live` sets the host model with `ANTHROPIC_MODEL`. The default is `claude-haiku-5-5` to limit usage. To use a different model, set `ANTHROPIC_MODEL` before you run the test. Checkmate does not select a model. The launcher passes the environment to Claude Code without changes.

The live test uses an isolated local fixture and gives the workers the minimum rules of `delegate`, `Read` and `Bash`, in that temporary workspace. After execution, it checks that `.checkmate/` holds only the database and that no `.playwright-cli/` directory stays. `test/live.ts` checks delegated setup, planning gaps, oracle decisions, revision, approval, execution with a defect, result acceptance, a retest on a new build, and a plan skill in one session. `test/live-session.ts` checks execution in one session and a permission denial. Each test writes stage, duration, and status to standard output and to `measurements.json` in the workspace. The workspace stays after the test. Its path is printed. It does not change product code or send fixture data to a production service.

The normal CI job runs on Ubuntu with Node.js 24. The live job runs only when selected in a manual workflow dispatch. Configure a repository secret for Claude authentication before that run. Do not expose secrets to untrusted pull requests.

## Contracts

Edit the schemas in `plugin/contracts/`. Regenerate the types and validators:

```sh
npm run generate
```

`plugin/src/types.ts` contains the contract types. `plugin/src/validators.js` contains the validators. Ajv compiles each schema to standalone code, and esbuild bundles the Ajv runtime helpers into the same file. Do not edit the generated files. `npm run type:check` fails when a generated file differs from the schemas.

The plan candidate validator uses the plan schema without `coverage`. The generator derives it. There is no separate schema file.

Add tests for changed relationships and failure paths. Do not replace browser or live checks with mocked success results.

The plugin uses the installed Claude Code CLI. Do not add a custom model loop or an Agent SDK runner. Keep model selection, authentication, and native permissions with the host.

## Native TypeScript

Run `plugin/bin/checkmate.ts` with Node.js. The runtime uses erasable TypeScript syntax. It does not need a compiler at startup.

`npm run type:check` checks types without emitting files. It covers the plugin, the scripts, and the tests. The tests are TypeScript and run directly with `node --test`.

## Plugin layout

The marketplace source is `./plugin`. Claude Code copies only that directory into its plugin cache. It does not run npm install. Keep runtime files in `plugin/`. Keep tests, scripts, documentation, and development tools outside it.

The plugin imports only Node.js built-in modules and its own files. Do not add runtime npm dependencies. `plugin/package.json` sets the module type only. `node test/plugin.ts` copies `plugin/` to a temporary directory and runs the CLI there.

The root package is private. It installs development dependencies and runs development commands. The npm CLI package is `cli/` (`@xoxoai/checkmate`). Its `prepack` script runs `scripts/build-cli.ts`, which bundles `cli/src/main.ts` and copies `plugin/` into the package. The release workflow does not publish it yet.

## GitHub releases

A merged PR to `main` starts the release job after verification passes, if the PR changes the plugin. A PR changes the plugin when it changes a file under `plugin/` or `.claude-plugin/marketplace.json`. Merges that change only documentation, tests, CI, or development dependencies do not create a release. The job updates the package, lockfile, plugin, and marketplace versions together. It commits the version, creates a tag, and creates a GitHub release.

The first plugin release is `v0.7.0`. Later merges increase the patch version. To select a new minor or major version, update all four version records in the PR. The selected version must be newer than every existing release tag.

Release jobs run one at a time. The job verifies the release candidate before it pushes the commit and tag together. It never publishes to npm.

If release creation fails after the push, rerun the failed job. You can also run CI manually on `main`. Enable `release` and enter the merged PR number in `pull_request`. The job reuses the release commit and tag for that PR. It does not increase the version again.

A manual release does not check the changed files. A manual release with no PR number creates a separate release request. Direct pushes without an associated merged PR do not start an automatic release.

The GitHub Actions token needs write access to repository contents. Repository rules must permit the release bot to push the version commit and tag. Live Claude checks run only when selected. They are not a required automatic release check.

## Documentation media

`docs/media/onboarding.html` defines the animation scenes. It uses the dark tokens in `docs/media/style.css`. The animation is 900 by 756 pixels. Its top band is a ring of four stations around the record: the planner and the oracle on the top edge, the factory and QA on the bottom edge, and the human badge for the review UI below. A retest is QA again on a new build. The amber path on the left edge goes from QA back to the planner for a new revision. The band below it is a swimlane diagram: lanes for the planner, the oracle, QA, and the factory, a Checkmate record lane at the bottom, and time from left to right. A dashed step in the oracle lane is a human in the review UI. The ring and the lanes match one to one: when a step appears in its lane, the matching station lights up, and the centre shows the records of that step. Keep one idea per scene and few records in each frame. `docs/media/swimlane.js` places the records under each step and draws the arrows. The animation is an illustrated workflow. It is not a live test recording.

The animation uses a small timeline in `onboarding.html`. Each step and record has `data-t`, the time in seconds when it appears. Each caption has `data-from` and `data-to`. A step with `data-station` also lights that station of the ring. `pans` sets where the track moves, and `window.DURATION` is the total. Give each scene enough time to read, about 4 to 6 seconds. Keep the scenes flat, so the GIF stays small. Prettier does not format these pages, because their text keeps exact whitespace.

Install Chromium and FFmpeg. Install development dependencies with `npm ci`. Render the animation:

```sh
node scripts/render-onboarding.ts
```

Set `CHECKMATE_BROWSER_EXECUTABLE` if Chromium is not at `/usr/bin/chromium`. The command updates `docs/img/onboarding.gif`. The page loads its fonts from `plugin/src/ui/assets/fonts/`. The script does not build the plugin.

Keep the labels of the animation consistent with the workflow. The README, the animation, and the other docs use "oracle" for the person or agent that decides.

`docs/examples/` contains exports from a live run. Do not edit them by hand. To update them, run `npm run test:live`, then export the plans and runs from the printed workspace with `checkmate export --out`. Read `docs/examples/README.md`.

`scripts/ui-demo.ts` seeds a demo workspace. `node scripts/ui-screenshots.ts <directory>` captures review UI screenshots of that workspace in PNG. It needs `CHECKMATE_BROWSER_EXECUTABLE`. The docs use the dark captures in `docs/img/ui/` as JPEG files, 1280 pixels wide:

```sh
CHECKMATE_BROWSER_EXECUTABLE=/usr/bin/google-chrome node scripts/ui-screenshots.ts /tmp/shots
for name in inbox plans plan run-gap run; do
  convert /tmp/shots/$name-dark.png -resize 1280x -quality 82 docs/img/ui/$name.jpg
done
```
