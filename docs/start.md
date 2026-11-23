# Start Checkmate

Checkmate records tests and decisions for one project in `.checkmate/checkmate.db`. Keep that directory in the project workspace and add it to `.gitignore`.

## Requirements

- Node.js 24.12.0 or later.
- For local runtime QA, a running application with a URL reachable from the workspace.
- Claude Code or Pi, configured in its host, for delegated planning and test work.
- Playwright CLI on `PATH` only when the test uses a browser.

Checkmate does not start the application. The host controls models, credentials, tools, and permissions.

## Install and open the review UI

1. Install the CLI:

   ```sh
   npm install -g @xoxoai/checkmate
   ```

2. Change to the application workspace:

   ```sh
   cd /path/to/your/project
   ```

3. Start the review UI:

   ```sh
   checkmate ui
   ```

4. Open the URL in the command output.
5. If no target exists, enter the app URL in **Set up the application** and submit the form. The new-change form then opens.
6. Otherwise, choose **New change**.
7. Enter the ticket file or paste the ticket text. Review the plan name, build ID, and test level.
8. Open Settings and choose a configured harness if the default is not correct.
9. Select **Start the test**.

The setup form records the URL, environment, and permitted test operations. Checkmate saves the target, plan, runs, decisions, and evidence in the local record.

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

Pi users can install the published package:

```sh
pi install npm:@xoxoai/checkmate
```

Open the project in Pi and use `/checkmate <objective>` or `/checkmate-ui`.

The plugin and npm CLI use the same local record. See [Factory workflows](factory.md) when a factory controls each stage directly.
