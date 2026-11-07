# Browser recipe

Use Microsoft Playwright CLI. Checkmate tests version `0.1.23`.
Use its installed skill for command details: `playwright-cli install --skills`.
Install that skill only when the caller permits changes to the workspace.

Use the `browserSession` from the run's `invocation.json` for every command:

```sh
playwright-cli -s=<session> open <target-url> --config=<browser-config>
playwright-cli -s=<session> snapshot
playwright-cli -s=<session> click <element-reference>
playwright-cli -s=<session> screenshot --filename=<run-directory>/evidence/page.png
playwright-cli -s=<session> close
```

A browser config can select an installed executable:

```json
{
	"browser": { "browserName": "chromium", "launchOptions": { "executablePath": "/usr/bin/chromium", "headless": true } }
}
```

Check that the selected executable exists. Do not assume that every host has this path.
Use a fresh session. Do not use `close-all`, `kill-all`, or a shared persistent browser profile.
Set a short idle timeout for abandoned sessions. The fixture tests use 30 seconds.
Save only relevant observations and screenshots. Review screenshots for sensitive data before retention.
Do not claim that screenshots or arbitrary page text are sanitized automatically.
