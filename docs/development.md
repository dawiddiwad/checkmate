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

It runs type and generated-file checks, lint, Prettier, and `npm test`. The test command builds and packs the CLI, installs it into disposable workspaces, and runs 154 end-to-end cases with real SQLite, loopback applications, controlled hosts, Pi, and Chromium. It fails when a prerequisite is missing, a case is absent, or a case skips. CI runs `npm run phase:verify`.

The 42-scenario proposal map is [test/e2e/scenarios.json](../test/e2e/scenarios.json). Some historical Factory campaign behavior is outside this checkout. The local external Factory fixture does not verify Factory checkout, archive, budget, or campaign ownership. Tests use controlled hosts; they do not test live model judgment or require paid model calls.

Use `npm test` to run only the packaged end-to-end suite after you install the same prerequisites. Use Chromium and the real Pi CLI. The runner checks that the browser is executable and `pi --version` succeeds; it does not verify their identity.

## Build and package

- `npm run build` regenerates contract types and bundles the plugin.
- `npm pack ./cli` runs the CLI package build and creates the installable tarball.
- `npm run type:check`, `npm run lint:check`, and `npm run format:check` run the individual static checks.

The root package is private. The published CLI package is `cli/`. The build bundles `cli/src/main.ts` into the plugin. The pack step copies the plugin, README, and license into the CLI package. Keep `LICENSE` and package metadata with the code.

## Tool recipes

Checkmate keeps what it knows about each test tool in `plugin/recipes/`. Each tool has a JSON recipe and the Markdown usage text that the recipe names. `node` gives `http`. `playwright-cli` gives `browser`. `maestro` gives `mobile`: it drives an app on an Android emulator or an iOS simulator. Setup records the tools that it finds as profile tools. The brief of a tester names the usage text of each tool of the target. The host still runs the tools. Checkmate reads the recipes when it runs, and the build digest includes them.

A recipe also gives the plan and run values of its tool. `observeFrom` maps each value that an assertion can observe from to `view` (what the tool shows now) or `state` (the stored state). `evidence` lists the evidence kinds that the tool makes. The optional `evidenceExtensions` maps a file extension to the default evidence kind of a file. A test of a plan can use only the `observeFrom` values of the recipes of the target tools. A run can record evidence kinds from those recipes and the built-in kind `observation`. A file uses the default kind for its extension from the target tools, or `observation` when those tools give no default.

A recipe also says what a target of its tool needs. `entryPoints` lists the entry points that an instance of such a target has: each has a `name`, a `kind` (`url`, `command`, or `value`), a `purpose` that the setup conversation shows, and an optional `pattern`, the regular expression that setup tests the value with. `node` and `playwright-cli` declare `web` with the pattern `^https?://`. `maestro` and `maestro-mcp` declare `app` and `device`. An entry point name means the same in every recipe. A recipe without `entryPoints` fits every target. `reachable` lists the checks that tell whether an instance answers, and all of them must pass. Core knows two kinds: `http` fetches the value of an entry (anything below HTTP 500 answers), and `command` runs a program and passes on exit code 0, and, with `contains`, when its output has each text (`{<entry name>}` stands for an entry value). A recipe with no `reachable` leaves the instance not checked. Quick setup records only the tools whose entry points are all among the given entries.

A recipe has the kind `cli` or `mcp`. A `cli` recipe describes a program that the tester runs in its shell. An `mcp` recipe describes an MCP server that Checkmate starts for the tester. `maestro-mcp` is the `mcp` recipe for `mobile`: it starts `maestro mcp --no-viewer`. An `mcp` recipe gives `server`, the command, arguments, and working directory of the server, and `tools`, the exact names of the server tools that a tester can call. Its `environment` goes to the server, not to the tester. `maestro-mcp` sets `XDG_STATE_HOME` to the work folder, so the Maestro logs of the server stay out of the home folder (checked on Maestro 2.12.1). An `mcp` recipe can also give `refusedArguments`, the arguments that a call of a tool may not give (`maestro-mcp` refuses `files` and `dir` of `run`), and `entryArguments`, the arguments that must have the value of an instance entry (`maestro-mcp` pins `device_id` to the `device` entry). A call without a pinned argument gets the entry value. Detection looks for the server command on `PATH`. It does not check that the command has an `mcp` subcommand. A server that does not start fails the tester, and the tester closes its tests as error.

Checkmate starts the server through `checkmate tool-server <recipe> <work folder> <session> [<entry>=<value> ...]`, in `plugin/src/tool-servers.ts`. It starts the server in the work folder of the tester, in a process group of its own. It lists only the tools of the recipe and refuses a call to any other tool, a refused argument, or another value of a pinned argument. When the host closes it, it stops the process group, so device drivers such as `xcodebuild` stop with the server. Claude Code workers and explorers get the server with `--mcp-config` and an `--allowedTools` rule for each recipe tool. They do not get `--strict-mcp-config`, because it also drops the MCP server of the plugin. Pi workers and explorers load the built-in MCP support (`--extension builtin:mcp`) and `plugin/pi/tool-servers.mjs`, which registers the server with `pi.registerMcpServer`. Pi then also connects the servers of the user's `mcp.json`, but `--tools` keeps only the listed MCP tools.

The tools of a tester are the tools of the plan. A plan request can name them, for example `"tools": ["maestro"]`, and otherwise it has the tools of the target. When the tools of a tester include two recipes of one capability, the tester gets one of them. A tester that Checkmate starts in a new process gets the `mcp` recipe. A tester of the host session gets the other recipe, because Checkmate cannot attach a server there. The brief, the usage-text line, the delegated instruction, and the launch arguments use the same recipe. The delegated attempt records the tools of the worker in `data.tools`.

A recipe can also give `delegatedInstruction`, the text that a delegated execute worker gets for the tool, and `closeSession`, the arguments that close the tool session after a delegated run. Each run has one tool session ID, `toolSession`, that every tool of the run uses.

The start event of an exploration stores the tool session name and data prefix of each tester. The session name starts with the exploration marker, which includes the workspace nonce. The data prefix adds a final hyphen. The verifier uses the same marker with the suffix `-verify-`.

The contracts list every value of every recipe, because the models read the enums as the allowed values. After you change a recipe value, run `npm run generate`. `scripts/generate-contracts.ts` writes the `observeFrom` and evidence kind enums, and `npm run type:check` fails when they are stale.

The Maestro CLI recipe tells testers to set `XDG_STATE_HOME` per command to move Maestro 2.12.1's default test logs into the work folder. `--test-output-dir` and `--debug-output` direct flow artifacts and debug output from `test`. See [Maestro's log path](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.12.1/maestro-cli/src/main/java/maestro/cli/report/TestDebugReporter.kt#L218-L225) and [test output options](https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts).

## Testing a branch before release

A branch install needs no build step. Run `npm run build` and commit `plugin/dist/checkmate.js` before you push. `npm run type:check` fails when the bundle is stale.

Claude Code runs `dist/checkmate.js` from its installed plugin. Pi loads its extension and skill from `plugin/pi/` in both the git checkout and the npm package. Both Pi entry points use `plugin/dist/checkmate.js`. The npm pack step copies `plugin/` into the package because npm packages cannot include files from a parent directory. The npm `checkmate` executable points to that copy too.

Push the branch, then install it into a clean Claude Code or Pi setup:

```sh
claude plugin marketplace add dawiddiwad/checkmate@<branch>
claude plugin install checkmate@checkmate
pi install git:github.com/dawiddiwad/checkmate@<branch> -l
```

Check the build in each host:

```sh
node "<plugin root>/dist/checkmate.js" --version
node .pi/git/github.com/dawiddiwad/checkmate/plugin/dist/checkmate.js --version
```

The Claude Code plugin root is under `~/.claude/plugins/cache/checkmate/checkmate/`. To keep your own setup clean, set `HOME` to a temporary folder first. Remove an old copy with `claude plugin uninstall checkmate@checkmate` or `pi remove <source> -l`.

Use the host commands to test the conversation. The agent runs the bundled CLI and replies with the outcome and any decision it needs. The standalone npm CLI gives command hints to its callers.

## Agent-only instructions

> **Agent only:** Read [AGENTS.md](../AGENTS.md) and [development procedures](../.agents/wiki/development-procedures.md) before changing code or tests. They link to the coding standards, architecture, and task-specific skills. Runtime instructions for delegated tests live in the [test skill](../plugin/skills/test/SKILL.md) and [stage rules](../plugin/references/workflow.md). These files govern agent prompts; do not replace them with this guide.

## Documentation media

Run `npm run build`. Set `CHECKMATE_BROWSER_EXECUTABLE` and run `node scripts/capture-docs-ui.ts` to capture the current review UI with disposable sample records. Set `CHECKMATE_BROWSER_EXECUTABLE` and run `node scripts/render-onboarding.ts` to rebuild the onboarding GIF. It needs a full FFmpeg on `PATH`, or the path to one in `FFMPEG`, for example the `ffmpeg-static` binary installed outside the repository. It renders `docs/media/onboarding.html`: the factory storyboard. The GIF ends after the factory part and has no record counters. Update the storyboard when the factory flow changes. Set `CHECKMATE_BROWSER_EXECUTABLE` and run `node scripts/render-review-ui.ts` to rebuild the review UI GIF, `docs/media/ui/review.gif`. It records the real review UI in Chromium on the `seedShowcase` records of `scripts/ui-demo.ts`. It needs FFmpeg on `PATH` or in `FFMPEG`. Its chat scene asks a live Claude Code model, so Claude Code must be on `PATH`; the turn costs a few cents. The recorder fails when a decision, the evidence viewer, or the saved chat change does not show.
