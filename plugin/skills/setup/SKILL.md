---
name: setup
description: Set up a Checkmate target profile from a recorded setup request. Check tools and access. Save the profile with target save.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`. It has the command rules, the actor rules, and the report format.

## Tools

A target profile lists the tools that the stages can use. Each tool has a `name`, a `kind`, and a `purpose`:

- `cli`: a command on the `PATH`, for example `playwright-cli` or `node`.
- `mcp`: an MCP server that the host session loads.
- `skill`: a Claude Code skill that the host session loads.

The caller names tools with `checkmate target open ... --tool <name>:<kind>:<purpose>`. Checkmate records each tool and whether it was reachable at setup. The host gives the permission to use a tool. Checkmate does not.

The references `browser.md` and `http.md` are optional recipes for the default tools `playwright-cli` and `node`. Read one only when the profile uses that tool.

## Steps

1. Run `checkmate target request <targetId>`. It prints the base URL, capabilities, allowed operations, and requested tools.
2. Run `checkmate target show <targetId>`. If a profile exists, keep its local choices. Save a new revision only for a change.
3. Read the project instructions, for example `AGENTS.md`. Source code is optional.
4. Check Node.js 24.12.0 or later.
5. Make the tool list. Use each requested tool. When the request names no tool for a capability, suggest a default: `playwright-cli` (`cli`) for `browser`, `node` (`cli`) for `http`.
6. Check that each tool is reachable:
   - `cli`: run `command -v <name>`, then `<name> --version`. Record the actual version.
   - `mcp`: check that the MCP server tools are available in this session.
   - `skill`: check that the skill is available in this session.
7. Record each tool with `reachable` set to the result of the check.
8. Check the target with a read-only request. Do not run test actions.
9. For a browser tool, open `about:blank` in a new isolated session with the caller's browser config. Close that session. For `playwright-cli`, read `${CLAUDE_PLUGIN_ROOT}/references/browser.md`.
10. Use the caller's running application. Start it only when the caller authorized a startup command.
11. Write the profile. Use the shape below.
12. Send the profile in a heredoc: `checkmate target save <targetId> <<'EOF'`, the JSON, then `EOF`.
13. Return the response of `target save`. In the same session, report to the caller in the format of `workflow.md`: a table of the tools, then `Done:` and `Next:`. The next step is usually `checkmate plan open <planId> --target <targetId>@<revision>`.

```json
{
	"contractVersion": "toolkit-2",
	"targetId": "<from the request>",
	"revision": 1,
	"baseUrl": "<from the request>",
	"environment": "local_fixture",
	"capabilities": ["<from the request>"],
	"tools": [
		{
			"name": "playwright-cli",
			"kind": "cli",
			"purpose": "Drive the browser.",
			"version": "<actual>",
			"reachable": true
		}
	],
	"authentication": { "kind": "none", "references": [] },
	"allowedOperations": ["<from the request>"],
	"startup": { "owner": "caller", "command": null },
	"cleanup": "<what the run must clean up>",
	"readyForLiveExecution": true
}
```

- Copy `targetId`, `baseUrl`, `capabilities`, and `allowedOperations` exactly from the request.
- Give `tools` one entry for each requested tool. Copy its name, kind, and purpose from the request. Add the default tools that you suggested. Do not add a Claude entry.
- Give `version` only when you know it, for example from `--version`. Do not write `unknown`.
- A capability is a label for plan tests. It does not need a fixed executable.
- Set `readyForLiveExecution` to `true` only when every requested tool is reachable and every target check passed. Else set `false`. Checkmate refuses `true` when a requested tool is not reachable.
- Checkmate records the tools and checks the profile. It does not enforce permissions. The host controls them.
- Use `revision` 1 for a new profile. Use the latest revision plus 1 for a changed profile.
- Do not add `approvals` unless the caller asked for a policy. The default requires plan approval and result acceptance.
