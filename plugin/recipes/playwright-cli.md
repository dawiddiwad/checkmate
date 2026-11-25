# Browser recipe

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Use this recipe when the plan lists the `playwright-cli` tool. For another browser tool, for example an MCP server, use the same rules for sessions and evidence.

Microsoft Playwright CLI is the default browser tool. Checkmate is tested with version `0.1.23`.
For command details, run `playwright-cli --help` or `playwright-cli <command> --help`.

Use the run's `toolSession` as the session for every command. `run begin` and `run resume` print it. A delegated prompt names it.

The shortest reliable sequence:

```sh
PLAYWRIGHT_MCP_OUTPUT_DIR=.checkmate/tmp/<runId> playwright-cli -s=<session> open <url> --config=<browser-config> --idle-timeout=30000
playwright-cli -s=<session> snapshot
playwright-cli -s=<session> fill <element-reference> "<text>"
playwright-cli -s=<session> click <element-reference>
playwright-cli -s=<session> snapshot
playwright-cli -s=<session> screenshot --filename=.checkmate/tmp/<runId>/T1-A1.png
playwright-cli -s=<session> close
```

- Open, then snapshot. The snapshot gives the element references (`e5`, `e8`) and their labels.
- Act only by an element reference from the latest snapshot. Never invent a selector or a label name.
- If the snapshot has no controls, wait one second and snapshot again.
- After each action, snapshot again and read the value from that snapshot.
- If a reference is not in the snapshot, wait one second, snapshot again, and retry once.
- If the reference is still missing, close the test as error. Give the snapshot excerpt as evidence. Do not record a defect.
- A text or element that a check names is not on the snapshot after the action: record it with `run check --absent` and the snapshot excerpt as evidence. The code compares the absence with the expected value. This is a result, not an error.

A browser config can select an installed executable:

```json
{
	"browser": { "browserName": "chromium", "launchOptions": { "executablePath": "/usr/bin/chromium", "headless": true } }
}
```

- Use the browser config of the project when the project instructions name one. The default path is `.playwright/cli.config.json`.
- Check that the selected executable exists. Do not assume that every host has this path.
- Playwright CLI writes snapshots and logs to an output directory. Without `PLAYWRIGHT_MCP_OUTPUT_DIR`, it writes `.playwright-cli/` in the workspace. Set the variable on the `open` command. The session keeps it for the next commands.
- In execute, use `.checkmate/tmp/<runId>`. `run finish` removes that directory with its contents.
- In setup, use `.checkmate/tmp/setup-<targetId>`. `target save` removes that directory with its contents.
- Use a new session. Do not use `close-all`, `kill-all`, or a shared persistent browser profile.
- Close the session at the end of the stage, also after a failure.
- When page text is the evidence, send a short excerpt of the snapshot with `--evidence -`. Do not write a text file.
- Save only relevant observations and screenshots. Do not save pages that show credentials.
- Checkmate does not sanitize screenshots or page text.
