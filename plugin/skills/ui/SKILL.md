---
name: ui
description: Open the Checkmate review UI from the installed plugin. No separate npm CLI install is needed.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Run `checkmate plan list` to read the current workspace database.
2. Start the bundled server as a background task from the caller's workspace:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" ui
```

3. Show the local URL printed by the command. Open it with the host's browser tool when available.
4. Keep the task running while the caller uses the UI. Stop it when the caller is done.

The server uses loopback access and a session token. It does not need a global `checkmate` command or an npm install. Add `--port <n>` when the caller requests a port. Do not write a log file just to launch the UI.
