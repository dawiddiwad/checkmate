# Browser recipe

Use Microsoft Playwright CLI. Checkmate tests version `0.1.23`.
For command details, run `playwright-cli --help` or `playwright-cli <command> --help`.

Use the run's `browserSession` for every command. `run begin` and `run resume` print it. A delegated prompt names it.

```sh
playwright-cli -s=<session> open <url> --config=<browser-config> --idle-timeout=30000
playwright-cli -s=<session> snapshot
playwright-cli -s=<session> click <element-reference>
playwright-cli -s=<session> screenshot --filename=.checkmate/tmp/<runId>/T1-A1.png
playwright-cli -s=<session> close
```

A browser config can select an installed executable:

```json
{
	"browser": { "browserName": "chromium", "launchOptions": { "executablePath": "/usr/bin/chromium", "headless": true } }
}
```

- Use the caller's browser config when the project instructions name one. The default path is `.playwright/cli.config.json`.
- Check that the selected executable exists. Do not assume that every host has this path.
- Use a new session. Do not use `close-all`, `kill-all`, or a shared persistent browser profile.
- Close the session at the end of the stage, also after a failure.
- Write a short text observation, for example `.checkmate/tmp/<runId>/T1-A1.txt`, when page text is the evidence.
- Save only relevant observations and screenshots. Do not save pages that show credentials.
- Checkmate does not sanitize screenshots or page text.
