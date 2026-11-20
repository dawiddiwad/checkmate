# Run Checkmate with Pi

Checkmate can start the installed `pi` command for QA work. Configure the provider and model in Pi. Use a workspace where the selected tools can run the tests.

## Use this branch

Install Pi and configure a provider in Pi. This branch is tested with Pi 1.5.2. From the repository root, build the CLI and install the local skill package:

```sh
npm ci
npm run build
node scripts/build-cli.ts
pi install ./cli
```

Start Pi in the project to test. Enter `/skill:checkmate` with the objective or the ticket path. The skill uses the CLI from the same package. Keep the built package at its installed path.

## Use the CLI

Set the harness in the shell that starts Checkmate:

```sh
export CHECKMATE_HARNESS=pi
```

Run the built CLI as `node /absolute/path/to/checkmate/cli/dist/checkmate.js` from the project workspace. If the CLI from this branch is on your path, you can use its command name. For an existing plan request:

```sh
checkmate delegate plan checkout
checkmate status checkout
```

A delegated stage uses Pi's `read` and `bash` tools. The launcher disables MCP for that stage. For a process exploration, give each permitted tool name with `--allow`, for example `--allow Read --allow Bash`. A scoped Claude permission rule is not a Pi tool name. Use a trusted workspace for shell access.

Pi uses its configured model by default. To select a different model for child processes, set `CHECKMATE_PI_MODEL`. Set `CHECKMATE_PI_PROVIDER` with that model to select its provider. Supply credentials through Pi's login or its provider environment variables. Use the same environment when you start the review UI. The UI verifies that the Pi permission extension loaded before it sends a request. The UI asks for permission before a request uses a tool.

Claude Code is the default when `CHECKMATE_HARNESS` is unset. Its marketplace plugin and session commands use Claude Code's Agent tool. The Pi skill uses CLI processes for the testers.
