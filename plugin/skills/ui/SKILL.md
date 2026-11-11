---
name: ui
description: Start the Checkmate review UI for the workspace in the background and print its URL.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Start the UI from the caller's workspace as a background command. Use the background option of the shell tool:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" ui
```

2. Read the first output line. It is `completed ui url=<url>`.
3. Print the URL to the person. Tell the person to open it in a browser on this computer.
4. Keep the command running. Stop the background command only when the person asks.

- Add `--port <port>` only when the person asks for a port. The default is a free port.
- The UI listens on `127.0.0.1` only. Do not expose it on another interface.
- The UI writes to the database only when the person submits a form. The UI records the person's name with each decision.
- If the first line starts with `invalid_request` or `rejected`, return the `reason:` lines. Do not start a second UI.
