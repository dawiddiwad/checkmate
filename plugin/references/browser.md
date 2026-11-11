# Browser recipe

Use this optional recipe only when the caller already uses Microsoft Playwright CLI. Checkmate tests version `0.1.23`. Other host browser tools are supported.
For command details, run `playwright-cli --help` or `playwright-cli <command> --help`.

Use the run's `browserSession` for every command. `run begin` and `run resume` print it. A delegated prompt names it.

```sh
playwright-cli -s=<session> open <url> --config=<browser-config> --idle-timeout=30000
playwright-cli -s=<session> snapshot
playwright-cli -s=<session> click <element-reference>
playwright-cli -s=<session> screenshot --filename=<evidenceDirectory>/T1-A1.png
playwright-cli -s=<session> close
```

Use a temporary copy of the caller's browser config when its defaults write files in the workspace. Keep its browser and permission settings. Set `outputDir` to a task-owned OS temporary directory and `outputMode` to `stdout`. Remove that temporary copy and its task-owned outputs after cleanup. Do not delete pre-existing caller files.

For example, a temporary browser config can select an installed executable:

```json
{
	"browser": {
		"browserName": "chromium",
		"launchOptions": { "executablePath": "/usr/bin/chromium", "headless": true }
	},
	"outputDir": "<task-owned temporary directory>",
	"outputMode": "stdout"
}
```

- Use the caller's browser config when the project instructions name one. The default path is `.playwright/cli.config.json`.
- Check that the selected executable exists. Do not assume that every host has this path.
- Use a new session. Do not use `close-all`, `kill-all`, or a shared persistent browser profile.
- Close the session at the end of the stage, also after a failure.
- Write a short text observation, for example `<evidenceDirectory>/T1-A1.txt`, when page text is the evidence.
- Save only relevant observations and screenshots. Do not save pages that show credentials.
- Checkmate does not sanitize screenshots or page text.
