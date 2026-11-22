# Run Checkmate with Pi

Use Node.js 24.12.0 or later. Install Pi on `PATH` and configure your provider in Pi. Checkmate is tested with Pi 1.5.2.

## Install the Pi extension

Install the published package:

```sh
pi install npm:@xoxoai/checkmate
```

To test an unreleased change, install its Git ref instead, for example `pi install git:github.com/dawiddiwad/checkmate@<ref>`. The published package contains the features of its released version.

Start Pi in the project workspace. Use these commands:

- `/checkmate-ui` starts or finds the workspace's review UI. It shows the URL and the active harness. The UI uses Pi by default and keeps any saved workspace choice.
- `/checkmate <test objective>` starts the Checkmate workflow in the Pi session. Give a ticket path or a test objective.

The package includes the engine, the review UI, and the skill. The UI stays open when you exit Pi. Use `/checkmate-ui stop` to close it, including before you remove the package. If a UI from an older Checkmate version is open, stop it once before you open the updated UI. Checkmate keeps the workspace record in `.checkmate/`.

## Use Pi from the CLI

If you start the UI with `checkmate ui`, select **Pi** in **Settings → Coding harness** and save. To select Pi for one CLI command, set `CHECKMATE_HARNESS=pi`.

## Tools and models

A delegated stage uses Pi’s `read` and `bash` tools. Run `checkmate delegate plan <planId>` or the equivalent stage command. Omit `--allow` and `--claude-arg` from the Claude Code examples in the factory guide. The launcher disables MCP for a delegated stage. For a process exploration, give each permitted tool name with `--allow`, for example `--allow Read --allow Bash`. A scoped Claude permission rule is not a Pi tool name. Use a trusted workspace for shell access.

Select separate request and tester models in **Settings → Coding harness → Models**. Pi supplies the list. A model choice for an individual tester applies to that tester. A model choice in a chat applies to that conversation. If none of these choices applies, Pi uses its current selection.

For a CLI override, set `CHECKMATE_PI_MODEL`. Set `CHECKMATE_PI_PROVIDER` with a model ID to select a provider. If you set only the provider, Checkmate uses the current saved model for that provider when it applies. Otherwise, Pi selects from the available models of that provider. Checkmate reports an error if Pi cannot select a model from that provider. Supply credentials through Pi.

If a Pi model list request times out when an exploration has a saved reasoning effort, Checkmate requests the list again. A text model list gives model names. Checkmate uses the effort levels that Pi reports for the selected model.

When Pi reports the provider and model of a call, Checkmate keeps the provider-qualified ID with the result. The exploration status and chat show the models Pi used. Checkmate keeps costs that Pi reports, including costs of calls that fail or stop. A missing cost stays unknown.
