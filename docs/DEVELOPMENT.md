# Development

Use the existing checkout. Cloud tasks already have an isolated workspace. Create a worktree only when the caller requests one.

Use Node.js 24 or later. Install pinned dependencies with `npm ci`. Use a separate feature branch for changes.

```sh
npm run phase:verify
npm run test:live
```

`phase:verify` checks types, lint, formatting, contracts, launcher failures, browser/API integration, and the installed npm package. It does not need a Claude credential.

The browser test requires a Chromium executable. Set `CHECKMATE_BROWSER_EXECUTABLE` when it is not `/usr/bin/chromium`. On a restricted Linux filesystem, set `XDG_CACHE_HOME` to a writable cache directory.

`test:live` requires an authenticated Claude Code CLI. Set `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `CHECKMATE_USE_HOST_LOGIN=1` for an existing host login. The test fails when authentication is unavailable. It does not silently skip.

The live test uses an isolated local fixture and permits Read, Write, Edit, and Bash in that temporary workspace. It checks setup, planning gaps, default blocking, explicit partial execution, revision, defect detection, retest, and a skill invoked within one session. It records stage durations and saves artifacts in the printed temporary directory. It does not change product code or send fixture data to a production service.

The normal CI job runs on Ubuntu with Node.js 24. The live job runs only when selected in a manual workflow dispatch. Configure a repository secret for Claude authentication before that run. Do not expose secrets to untrusted pull requests.

## Contracts

Edit the schemas in `contracts/`. Regenerate the exported types:

```sh
node scripts/generate-types.mjs
node scripts/generate-types.mjs --check
```

Add tests for changed relationships and failure paths. Do not replace browser or live checks with mocked success results.

The plugin uses the installed Claude Code CLI. Do not add a custom model loop or an Agent SDK runner. Keep model selection, authentication, and native permissions with the host.
