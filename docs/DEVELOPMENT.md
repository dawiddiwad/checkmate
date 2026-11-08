# Development

Use the existing checkout. Cloud tasks already have an isolated workspace. Create a worktree only when the caller requests one.

Use Node.js 24.12.0 or later. Install pinned dependencies with `npm ci`. Use a separate feature branch for changes.

```sh
npm run phase:verify
npm run test:live
```

`phase:verify` checks types, lint, formatting, contracts, launcher failures, browser/API integration, release version updates, documentation examples, and a clean plugin install. It does not need a Claude credential.

The browser test requires a Chromium executable. Set `CHECKMATE_BROWSER_EXECUTABLE` when it is not `/usr/bin/chromium`. On a restricted Linux filesystem, set `XDG_CACHE_HOME` to a writable cache directory.

`test:live` requires an authenticated Claude Code CLI. Set `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `CHECKMATE_USE_HOST_LOGIN=1` for an existing host login. The test fails when authentication is unavailable. It does not silently skip.

`test:live` sets the host model with `ANTHROPIC_MODEL`. The default is `sonnet` to limit usage. To use a different model, set `ANTHROPIC_MODEL` before you run the test. Checkmate does not select a model. The launcher passes the environment to Claude Code without changes.

The live test uses an isolated local fixture and permits Read, Write, Edit, and Bash in that temporary workspace. It checks setup, planning gaps, default blocking, explicit partial execution, revision, defect detection, retest, and a skill invoked within one session. It records stage durations and saves artifacts in the printed temporary directory. It does not change product code or send fixture data to a production service.

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

The marketplace source is `./plugin`. Claude Code copies only that directory into its plugin cache. It does not run npm install. Keep runtime files in `plugin/`. Keep tests, scripts, documentation, and development tooling outside it.

The plugin imports only Node.js built-in modules and its own files. Do not add runtime npm dependencies. `plugin/package.json` sets the module type only. `node test/plugin.ts` copies `plugin/` to a temporary directory and runs the CLI there.

The root package is private. npm is used only to install development dependencies and run development commands. Do not add npm build or publish jobs. The last npm package version is `0.6.7`.

## GitHub releases

A merged PR to `main` starts the release job after verification passes, if the PR changes the plugin. A PR changes the plugin when it changes a file under `plugin/` or `.claude-plugin/marketplace.json`. Merges that change only documentation, tests, CI, or development dependencies do not create a release. The job updates the package, lockfile, plugin, and marketplace versions together. It commits the version, creates a tag, and creates a GitHub release.

The first plugin release is `v0.7.0`. Later merges increase the patch version. To select a new minor or major version, update all four version records in the PR. The selected version must be newer than every existing release tag.

Release jobs run one at a time. The job verifies the release candidate before it pushes the commit and tag together. It never publishes to npm.

If release creation fails after the push, rerun the failed job. You can also run CI manually on `main`. Enable `release` and enter the merged PR number in `pull_request`. The job reuses the release commit and tag for that PR. It does not increase the version again.

A manual release does not check the changed files. A manual release with no PR number creates a separate release request. Direct pushes without an associated merged PR do not start an automatic release.

The GitHub Actions token needs write access to repository contents. Repository rules must permit the release bot to push the version commit and tag. Live Claude checks run only when selected. They are not a required automatic release check.

## Documentation media

`docs/media/onboarding.html` defines the animation scenes. `docs/media/infographic.html` defines the static overview. Both use `docs/media/style.css`. The animation is an illustrated workflow. It is not a live test recording.

Keep the style: dark background, one blue accent word in each heading, monospace labels, and thin card borders. The animation uses a small timeline in `onboarding.html`: elements fade in, grow, dim, and highlight at set times. Prettier does not format these pages, because their text keeps exact whitespace.

Install Chromium and FFmpeg. Install development dependencies with `npm ci`. Render the animation and the overview:

```sh
node scripts/render-onboarding.ts
```

Set `CHECKMATE_BROWSER_EXECUTABLE` if Chromium is not at `/usr/bin/chromium`. The pages load Space Grotesk and JetBrains Mono from Google Fonts. This command updates `docs/img/onboarding.gif` and `docs/img/checkmate-infographic.png`. It does not build the plugin.

Keep the labels in both images consistent with the workflow.

The JSON examples contain file digests. Keep the referenced bytes unchanged, or regenerate all dependent references. The tests check the examples against the schemas and verify the evidence digests.
