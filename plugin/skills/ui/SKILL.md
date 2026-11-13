---
name: ui
description: Start the Checkmate review UI for the workspace in the background and print its URL.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

The review UI is for a human. In the UI, the human answers gaps, edits and approves plans, accepts results, and downloads reports. The plugin contains the UI. The npm CLI is not necessary.

1. If a UI of this workspace already runs in this session, give its URL again and go to step 3. Else start the UI from the application workspace as a background command. Use the background option of the shell tool:

```sh
checkmate ui
```

2. Read the first output line. It is `completed ui url=<url>`.
3. Run `checkmate inbox`. Report in the format of `workflow.md`: a table of the items that wait for a decision, `Done:` with the URL, and `Next:` with the first decision to make in the UI.
4. Tell the human to open the URL in a browser on this computer.
5. Keep the command running. Stop the background command only when the human asks.

- Add `--port <port>` only when the human asks for a port. The default is a free port.
- The UI listens on `127.0.0.1` only. Do not expose it on another interface.
- The UI writes to the database only when the human submits a form. Each form records the actor name. The UI fills in the same default actor as the commands: `CHECKMATE_ACTOR`, then the git user name, then the login name. The human can change it with `actor: <name>` in the header.
- If the first line starts with `invalid_request` or `rejected`, return the `reason:` lines. Do not start a second UI.
