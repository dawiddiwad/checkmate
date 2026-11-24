# Start Checkmate

Checkmate records tests and decisions for one project in `.checkmate/checkmate.db`. Keep that directory in the project workspace and add it to `.gitignore`.

## Requirements

- Node.js 24.12.0 or later.
- For local runtime QA, a running application with a URL reachable from the workspace.
- Claude Code or Pi, configured in its host, for delegated planning and test work.
- Playwright CLI on `PATH` only when the test uses a browser. Then also a Chrome or Chromium executable that runs, named in `.playwright/cli.config.json` under `browser.launchOptions.executablePath`. `checkmate setup` refuses early when it is missing and names the fix.

Checkmate does not start the application. The host controls models, credentials, tools, and permissions.

## Install and open the review UI

1. Install the CLI in the project:

   ```sh
   npm install --save-dev @xoxoai/checkmate
   ```

   A global install also works: `npm install -g @xoxoai/checkmate`. Then run `checkmate` instead of `npx checkmate`.

2. Change to the application workspace:

   ```sh
   cd /path/to/your/project
   ```

3. Start the review UI:

   ```sh
   npx checkmate ui
   ```

`checkmate --version` prints the build that runs. A `warning:` line names another build on `PATH`. Remove the copy that you do not use, for example `npm uninstall -g @xoxoai/checkmate`.

4. Open the URL in the command output.
5. If no target exists, enter the app URL in **Set up the application** and submit the form. The new-change form then opens.
6. Otherwise, choose **New change**.
7. Enter the ticket file or paste the ticket text. Review the plan name, build ID, and test level.
8. Open Settings and choose a configured harness if the default is not correct.
9. Select **Start the test**.

The setup form records the URL, the environment, the permitted test operations, and the data kind: a reset command, a reset by the environment, or isolation. A run that can change data needs a data kind. Without it, Checkmate refuses the run and names the fix. [Data kinds](factory.md#data-kinds-prepare-and-cleanup) gives the options. Checkmate saves the target, plan, runs, decisions, and evidence in the local record.

## Check the result

Open the run in the review UI. Read its assertions and evidence. The result can report a failure and still be complete: that means QA recorded what it found. The oracle decides whether the record is correct. Acceptance does not mean that the application passed.

If the result contains an open gap, answer it before QA continues. If it contains a defect, give the factory the evidence and ask for a fix and a new build. [Local human-oracle QA](local-qa.md) gives the command and recovery steps.

## Use a host plugin

Claude Code users can install the plugin without the npm CLI:

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Open the project in Claude Code and use `/checkmate:test`.

To run a local build from a checkout, start Claude Code with its plugin directory:

```sh
claude --plugin-dir /path/to/checkmate/plugin
```

This loads the checkout for that session only. It wins over an installed copy, and the installed copy does not load beside it.

A user-level `checkmate@checkmate` plugin also changes the result. A project-level install with the same plugin ID loses to it. Check the installed plugins with `claude plugin list`. Update the user-level copy with `claude plugin update checkmate@checkmate`. Remove it with `claude plugin uninstall checkmate@checkmate`.

Check which build runs:

```sh
checkmate --version
```

The first line shows the build digest of the running plugin. A `warning:` line means that the `checkmate` on `PATH` is another build.

Pi users can install the published package:

```sh
pi install npm:@xoxoai/checkmate
```

Open the project in Pi and use `/checkmate <objective>` or `/checkmate-ui`.

For one project only, install into the project:

```sh
pi install npm:@xoxoai/checkmate -l
```

Pi loads a project package only after it approves the folder. Start Pi with `--approve`, or approve the folder when Pi asks. Until then, Pi loads a global copy if one is installed.

Checkmate prints a `warning:` line when Pi declares another Checkmate package. Remove the copy you do not use:

```sh
pi remove <source>        # global copy
pi remove <source> -l     # project copy
```

Run `checkmate --version` to see the build that runs and the copy on PATH.

For a headless run (`pi -p`), close standard input or redirect it from `/dev/null`. Pi reads standard input until it ends, so a run with open input waits forever.

The plugin and npm CLI use the same local record. See [Factory workflows](factory.md) when a factory controls each stage directly.
