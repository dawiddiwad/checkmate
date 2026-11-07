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

The live test uses an isolated local fixture and permits Read, Write, Edit, and Bash in that temporary workspace. It checks setup, planning gaps, default blocking, explicit partial execution, revision, defect detection, retest, and a skill invoked within one session. It records stage durations and saves artifacts in the printed temporary directory. It does not change product code or send fixture data to a production service.

The normal CI job runs on Ubuntu with Node.js 24. The live job runs only when selected in a manual workflow dispatch. Configure a repository secret for Claude authentication before that run. Do not expose secrets to untrusted pull requests.

## Contracts

Edit the schemas in `contracts/`. Regenerate the exported types:

```sh
node scripts/generate-types.ts
node scripts/generate-types.ts --check
```

Add tests for changed relationships and failure paths. Do not replace browser or live checks with mocked success results.

The plugin uses the installed Claude Code CLI. Do not add a custom model loop or an Agent SDK runner. Keep model selection, authentication, and native permissions with the host.

## Native TypeScript

Run `bin/checkmate.ts` with Node.js. The runtime uses erasable TypeScript syntax. It does not need a compiler at startup.

`npm run type:check` checks types without emitting files. JSON Schemas define the contracts. `src/types.ts` contains the generated contract types.

The package is private. npm is used only to install dependencies and run development commands. Do not add npm build or publish jobs. The published npm package stays at `0.6.6`.

## GitHub releases

A merged PR to `main` starts the release job after verification passes. This includes Dependabot PRs. The job updates the package, lockfile, plugin, and marketplace versions together. It commits the version, creates a tag, and creates a GitHub release.

The first plugin release is `v0.7.0`. Later merges increase the patch version. To select a new minor or major version, update all four version records in the PR. The selected version must be newer than every existing release tag.

Release jobs run one at a time. The job verifies the release candidate before it pushes the commit and tag together. It never publishes to npm.

If release creation fails after the push, rerun the failed job. You can also run CI manually on `main`. Enable `release` and enter the merged PR number in `pull_request`. The job reuses the release commit and tag for that PR. It does not increase the version again.

A manual release with no PR number creates a separate release request. Direct pushes without an associated merged PR do not start an automatic release.

The GitHub Actions token needs write access to repository contents. Repository rules must permit the release bot to push the version commit and tag. Live Claude checks run only when selected. They are not a required automatic release check.

## Documentation media

`docs/media/onboarding.html` defines the animation scenes. The animation is an illustrated workflow. It is not a live test recording.

Install Chromium and FFmpeg. Install development dependencies with `npm ci`. Render the animation and poster:

```sh
node scripts/render-onboarding.ts
```

Set `CHECKMATE_BROWSER_EXECUTABLE` if Chromium is not at `/usr/bin/chromium`. This command updates `docs/img/onboarding.gif` and `docs/img/onboarding-poster.png`. It does not build the plugin.

`docs/img/checkmate-infographic.png` is the static overview. Keep its labels consistent with the workflow.

The JSON examples contain file digests. Keep the referenced bytes unchanged, or regenerate all dependent references. The tests check the examples against the schemas and verify the evidence digests.
