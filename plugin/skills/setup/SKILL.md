---
name: setup
description: Set up a Checkmate target profile from a recorded setup request. Check tools and access. Save the profile with target save, and add the first instance.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`. It has the command rules, the actor rules, and the report format.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

## Tools

A target profile lists the tools that the stages can use. Each tool has a `name`, a `kind`, and a `purpose`:

- `cli`: a command on the `PATH`, for example `playwright-cli` or `node`.
- `mcp`: an MCP server that the host session loads.
- `skill`: a Claude Code skill that the host session loads.

The factory, or the oracle in the same session, names tools with `checkmate target open ... --tool <name>:<kind>:<purpose>`. Checkmate records each tool and whether it was reachable at setup. The host gives the permission to use a tool. Checkmate does not.

The references `browser.md` and `http.md` are optional recipes for the default tools `playwright-cli` and `node`. Read one only when the profile uses that tool.

## Entry points and instances

A target has entry points. An entry point has a `name`, a `kind`, and a `purpose`:

- `url`: a URL of any scheme, for example `https://shop.example.com`.
- `command`: a command that QA runs at test time, for example a command that prints a one-time login URL.
- `value`: an opaque value, for example an org alias.

An instance is one place where the target runs, for example `local`, `uat`, or `staging`. An instance gives one value for each entry point. Checkmate records the value of a `command` entry, not its output. Adding or retiring an instance needs no new profile revision and no approval.

## Steps

1. Run `checkmate target request <targetId>`. It prints the entry points, capabilities, allowed operations, and requested tools.
   - If it refuses with `Unknown target`, and you are in the same session, record the request from the oracle's message:

     ```sh
     checkmate target open <targetId> --entry-point "web:url:Storefront." --capabilities browser,http \
       --operations read_catalog,create_fixture_order --tool "playwright-cli:cli:Drive the browser."
     ```

   - Give `--entry-point <name>:<url|command|value>:<purpose>` once for each entry point. Give `--tool` once for each tool that the oracle names. Ask the oracle for a missing entry point, capability, or operation. Do not invent operations.
   - In a delegated stage or a sub-agent, do not record a request. Return `needs_decision` with the reason.
2. Run `checkmate target show <targetId>`. If a profile exists, keep its local choices. Save a new revision only for a change.
3. Run `checkmate target instance list <targetId>`. When an instance is active, use it for the checks below. When no instance is active, find the first instance:
   - Take the entry values from the oracle's message or from the project instructions, for example `AGENTS.md`.
   - Name the instance after the place where the target runs, for example `local`. Use the name that the oracle or the project instructions give.
   - When a value is missing, ask the oracle in the same session. In a delegated stage or a sub-agent, return `needs_decision` with the missing entry point as the reason.
4. Read the project instructions, for example `AGENTS.md`. Source code is optional.
5. Check Node.js 24.12.0 or later.
6. Make the tool list. Use each requested tool. When the request names no tool for a capability, suggest a default: `playwright-cli` (`cli`) for `browser`, `node` (`cli`) for `http`.
7. Check that each tool is reachable:
   - `cli`: run `command -v <name>`, then `<name> --version`. Record the actual version.
   - `mcp`: check that the MCP server tools are available in this session.
   - `skill`: check that the skill is available in this session.
8. Record each tool with `reachable` set to the result of the check.
9. Check the target through the entry values of the instance with a read-only request. For a `command` entry, run the command and use its output only for this check. Do not run test actions.
10. For a browser tool, open `about:blank` in a new isolated session with the browser config of the project. Put the browser output in `.checkmate/tmp/setup-<targetId>/`. Close that session. For `playwright-cli`, read `${CLAUDE_PLUGIN_ROOT}/references/browser.md`.
11. Use the running application. Start it only when the owner of the application authorized a startup command.
12. Write the profile. Use the shape below.
13. Send the profile in a heredoc: `checkmate target save <targetId> <<'EOF'`, the JSON, then `EOF`.
14. When no instance is active, add the first instance after `target save`. Give `--entry` once for each entry point:

    ```sh
    checkmate target instance add <targetId> local --entry web=http://127.0.0.1:4173 --environment "Local fixture"
    ```

    Add `--reference <name>` for an authentication alias or an environment variable name. Do not write a credential value.

15. Return the response of `target save`. In the same session, report to the oracle in the format of `workflow.md`: a table of the tools, then `Done:` and `Next:`. The next step is usually a plan: `/checkmate:plan <planId> for <targetId>@<revision>` with the objective and the sources. When `readyForLiveExecution` is `false`, name the missing tool or check instead.

```json
{
	"contractVersion": "toolkit-2",
	"targetId": "<from the request>",
	"revision": 1,
	"entryPoints": [{ "name": "web", "kind": "url", "purpose": "<from the request>" }],
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
	"startup": { "owner": "factory", "command": null },
	"cleanup": "<what the run must clean up>",
	"readyForLiveExecution": true
}
```

- Copy `targetId`, `entryPoints`, `capabilities`, and `allowedOperations` exactly from the request.
- Do not put an entry value, a URL, or an environment name in the profile. These belong to an instance.
- Give `tools` one entry for each requested tool. Copy its name, kind, and purpose from the request. Add the default tools that you suggested. Do not add a Claude entry.
- Give `version` only when you know it, for example from `--version`. Do not write `unknown`.
- A capability is a label for plan tests. It does not need a fixed executable.
- Set `readyForLiveExecution` to `true` only when every requested tool is reachable and every target check passed. Else set `false`. Checkmate refuses `true` when a requested tool is not reachable.
- Checkmate records the tools and checks the profile. It does not enforce permissions. The host controls them.
- Use `revision` 1 for a new profile. Use the latest revision plus 1 for a changed profile.
- Do not add `approvals` unless the oracle asked for a policy. The default requires plan approval and result acceptance.
