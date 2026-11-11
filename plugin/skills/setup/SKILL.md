---
name: setup
description: Set up a Checkmate target profile from a recorded setup request. Check tools and access. Save the profile with target save.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Run `checkmate target request <targetId>`. It prints the base URL, capabilities, allowed operations, and context/tool instructions. Use the tools already available in the caller's host.
2. Run `checkmate target show <targetId>`. If a profile exists, keep its local choices. Save a new revision only for a change.
3. Read the project instructions, for example `AGENTS.md`. Source code is optional.
4. Before checking tools, configure their outputs to stdout or a task-owned OS temporary directory. Preserve the caller's config; use a temporary copy when needed. Check Node.js 24.12.0 or later. Check each requested capability with an available host tool. Record the tool name and its actual version, or `host-managed` for a connector that exposes no version.
5. Check target access only through the health URL or safe probe named by the caller or project instructions. A GET request can still perform a test action. Do not call functional endpoints, for example quotes, checkout, or orders, during setup. If no safe access check is defined, return the missing probe as a reason.
6. For `browser`, open `about:blank` with the caller's existing browser tool to check browser access. Do not navigate to the application during this check. Use an isolated session when the tool supports one. Close only the session you created.
7. Use the caller's running application. Start it only when the caller authorized a startup command.
8. Send the profile directly to `checkmate target save <targetId>` on standard input. Use the shape below. Do not save a JSON file.
9. Read `checkmate target show <targetId>` again. Return the save response and the saved revision.

```json
{
	"contractVersion": "toolkit-2",
	"targetId": "<from the request>",
	"revision": 1,
	"baseUrl": "<from the request>",
	"environment": "local_fixture",
	"capabilities": ["<from the request>"],
	"tooling": [
		{ "capability": "browser", "executable": "<available host tool>", "version": "<actual or host-managed>" }
	],
	"authentication": { "kind": "none", "references": [] },
	"allowedOperations": ["<from the request>"],
	"startup": { "owner": "caller", "command": null },
	"cleanup": "<what the run must clean up>",
	"readyForLiveExecution": true
}
```

- Copy `targetId`, `baseUrl`, `capabilities`, and `allowedOperations` exactly from the request.
- Give `tooling` exactly one entry for each capability. Use the available tool, skill, connector, or MCP tool name. Do not require `playwright-cli` or `node` for a capability. Do not add a Claude entry.
- Set `readyForLiveExecution` to `true` only when every tool and target check passed. Else set `false` and give each missing item as a reason.
- Use `revision` 1 for a new profile. Use the latest revision plus 1 for a changed profile.
- Do not add `approvals` unless the caller asked for a policy. The default requires plan approval and result acceptance.

- Copy the optional `contextInstructions` and `toolInstructions` from the setup request into the profile. They tell later stages where to gather context and how to use the caller's tools.
