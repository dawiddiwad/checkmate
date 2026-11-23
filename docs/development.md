# Develop Checkmate

Checkmate runs its CLI from a packed npm artifact. The required local gate checks generated contracts, types, lint, formatting, and public workflows.

## Prerequisites

- Node.js 24.12.0 or later.
- A real Pi CLI on `PATH` (`pi --version` must work). CI pins Pi 1.5.2. The tests use controlled hosts and a local Pi provider; they do not require provider credentials.
- An executable Chromium browser. Set `CHECKMATE_BROWSER_EXECUTABLE` to its full path.
- Dependencies installed with `npm ci`.

On macOS, for example:

```sh
npm install -g @earendil-works/pi-coding-agent@1.5.2
export CHECKMATE_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
npm ci
npm run phase:verify
```

On Linux, use the path to the installed Chromium or Chrome executable.

## Required checks

Run the full gate:

```sh
npm run phase:verify
```

It runs type and generated-file checks, lint, Prettier, and `npm test`. The test command builds and packs the CLI, installs it into disposable workspaces, and runs 121 end-to-end cases with real SQLite, loopback applications, controlled hosts, Pi, and Chromium. It fails when a prerequisite is missing, a case is absent, or a case skips. CI runs `npm run phase:verify`.

The 42-scenario proposal map is [test/e2e/scenarios.json](../test/e2e/scenarios.json). Some historical Factory campaign behavior is outside this checkout. The local external Factory fixture does not verify Factory checkout, archive, budget, or campaign ownership. Tests use controlled hosts; they do not test live model judgment or require paid model calls.

Use `npm test` to run only the packaged end-to-end suite after you install the same prerequisites. Use Chromium and the real Pi CLI. The runner checks that the browser is executable and `pi --version` succeeds; it does not verify their identity.

## Build and package

- `npm run build` regenerates contract types and bundles the plugin.
- `npm pack ./cli` runs the CLI package build and creates the installable tarball.
- `npm run type:check`, `npm run lint:check`, and `npm run format:check` run the individual static checks.

The root package is private. The published CLI package is `cli/`. The build bundles `cli/src/main.ts` into the plugin and copies the same executable, plugin, README, and license into the CLI package. Keep `LICENSE` and package metadata with the code.

## Agent-only instructions

> **Agent only:** Read [AGENTS.md](../AGENTS.md) and [development procedures](../.agents/wiki/development-procedures.md) before changing code or tests. They link to the coding standards, architecture, and task-specific skills. Runtime instructions for delegated tests live in the [test skill](../plugin/skills/test/SKILL.md) and [stage rules](../plugin/references/workflow.md). These files govern agent prompts; do not replace them with this guide.

## Documentation media

Run `node scripts/build-cli.ts`, then set `CHECKMATE_BROWSER_EXECUTABLE` and run `node scripts/capture-docs-ui.ts` to capture the current review UI with disposable sample records. Run `node scripts/render-onboarding.ts` with FFmpeg and Claude Code on `PATH` to rebuild the onboarding GIF. It renders the factory storyboard in `docs/media/onboarding.html`, then records the review UI in Chromium on the sample records of `scripts/ui-demo.ts`. The chat scenes call Claude Code.
