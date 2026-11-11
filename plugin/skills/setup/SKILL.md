---
name: setup
description: Set up a Checkmate target profile from a recorded setup request. Check tools and access. Save the profile with target save.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.
For the browser capability, read `${CLAUDE_PLUGIN_ROOT}/references/browser.md`.

1. Run `checkmate target request <targetId>`. It prints the base URL, capabilities, and allowed operations.
2. Run `checkmate target show <targetId>`. If a profile exists, keep its local choices. Save a new revision only for a change.
3. Read the project instructions, for example `AGENTS.md`. Source code is optional.
4. Check Node.js 24.12.0 or later. Check each requested tool. Record its actual version.
5. Check the target with a read-only request. Do not run test actions.
6. For `browser`, open `about:blank` in a new isolated session with the caller's browser config. Close that session.
7. Use the caller's running application. Start it only when the caller authorized a startup command.
8. Write the profile. Use the shape below.
9. Send the profile in a heredoc: `checkmate target save <targetId> <<'EOF'`, the JSON, then `EOF`.
10. Return the response of `target save`.

```json
{
	"contractVersion": "toolkit-2",
	"targetId": "<from the request>",
	"revision": 1,
	"baseUrl": "<from the request>",
	"environment": "local_fixture",
	"capabilities": ["<from the request>"],
	"tooling": [{ "capability": "browser", "executable": "playwright-cli", "version": "<actual>" }],
	"authentication": { "kind": "none", "references": [] },
	"allowedOperations": ["<from the request>"],
	"startup": { "owner": "caller", "command": null },
	"cleanup": "<what the run must clean up>",
	"readyForLiveExecution": true
}
```

- Copy `targetId`, `baseUrl`, `capabilities`, and `allowedOperations` exactly from the request.
- Give `tooling` exactly one entry for each capability. Use `playwright-cli` for `browser` and `node` for `http`. Do not add a Claude entry.
- Set `readyForLiveExecution` to `true` only when every tool and target check passed. Else set `false` and give each missing item as a reason.
- Use `revision` 1 for a new profile. Use the latest revision plus 1 for a changed profile.
- Do not add `approvals` unless the caller asked for a policy. The default requires plan approval and result acceptance.
