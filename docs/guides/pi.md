# Run Checkmate with Pi

Use Node.js 24.12.0 or later. Install Pi on `PATH` and configure your provider in Pi. Checkmate is tested with Pi 1.5.2.

## Install the Pi extension

Install the package from the Checkmate repository:

```sh
pi install git:github.com/dawiddiwad/checkmate@wip/pi
```

Start Pi in the project workspace. Use these commands:

- `/checkmate-ui` starts or finds the workspace's review UI. Open the URL that Pi shows. The UI uses Pi by default and keeps any saved workspace choice.
- `/checkmate <test objective>` starts the Checkmate workflow in the Pi session. Give a ticket path or a test objective.

The package includes the engine, the review UI, and the skill. The UI stays open when you exit Pi. Checkmate keeps the workspace record in `.checkmate/`.

## Use Pi from the CLI

If you start the UI with `checkmate ui`, select **Pi** in **Settings → Coding harness** and save. To select Pi for one CLI command, set `CHECKMATE_HARNESS=pi`.

## Tools and models

A delegated stage uses Pi's `read` and `bash` tools. The launcher disables MCP for that stage. For a process exploration, give each permitted tool name with `--allow`, for example `--allow Read --allow Bash`. A scoped Claude permission rule is not a Pi tool name. Use a trusted workspace for shell access.

Select separate request and tester models in **Settings → Coding harness → Models**. Pi supplies the list. For a CLI override, set `CHECKMATE_PI_MODEL`. Set `CHECKMATE_PI_PROVIDER` with a model ID to select a provider. Supply credentials through Pi.
