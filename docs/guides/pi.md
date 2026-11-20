# Run Checkmate with Pi

Install Pi on `PATH` and configure your provider in Pi. Checkmate is tested with Pi 1.5.2.

## Review UI and CLI

Start `checkmate ui` in the project workspace. Open **Settings → Coding harness**, select **Pi**, and save. New requests and tests use Pi immediately. The CLI also uses the saved choice. To select Pi for one command, run:

```sh
CHECKMATE_HARNESS=pi checkmate delegate plan checkout
```

## Interactive Pi skill

To use the skill from this branch, build it in the repository:

```sh
npm ci
npm run build
node scripts/build-cli.ts
pi install ./cli
```

Start Pi in the project workspace. Enter `/skill:checkmate` followed by a ticket path or test objective. The skill uses the built CLI. Keep the package at its installed path.

## Tools and models

A delegated stage uses Pi's `read` and `bash` tools. The launcher disables MCP for that stage. For a process exploration, give each permitted tool name with `--allow`, for example `--allow Read --allow Bash`. A scoped Claude permission rule is not a Pi tool name. Use a trusted workspace for shell access.

Select separate request and tester models in **Settings → Coding harness → Models**. Pi supplies the list. For a CLI override, set `CHECKMATE_PI_MODEL`. Set `CHECKMATE_PI_PROVIDER` with a model ID to select a provider. Supply credentials through Pi.
