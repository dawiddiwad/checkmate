---
name: setup
description: Set up a Checkmate target, correct its operations, or replace an instance.
---

Read the workspace instructions. Use Checkmate tools from the current session.

If the tool needed for the test has no recipe, add one as part of setup. Use the entry names from its recipe.

1. Read an example with `checkmate recipe list --json`. Write `<tool>.json` and the Markdown file named in `usage` side by side in a draft folder. Include `name`, `capability`, `kind`, `purpose`, `detect`, `environment`, `workspaceFolders`, `observeFrom`, `evidence`, and `usage`. For an executable, use its name with `kind: "cli"` and `detect: "path"`. For MCP, include `server` and `tools`. Declare needed entries in `entryPoints`. Omit it if none are needed.
2. Run `checkmate recipe add --workspace <absolute project path> --file <recipe.json>`. Use the project folder where this host session started, or the workspace named in the setup refusal. The tool and draft can be elsewhere.
3. Verify the reported workspace and fix any validation error. Call `{{tool setup}}` with the declared entries. Tell the person you added the recipe and which commands it can run.

If `checkmate` is unavailable, use `node "<plugin root>/dist/checkmate.js"` in its place.

1. Call `{{tool list_targets}}` when the target is unclear. Use the only target if it matches the request.
2. Ask for the application address or the entries its tool needs. For a remote target, confirm the environment and the operations the person permits. Record credential references.
3. Call `{{tool setup}}` with the information the person gave. Use `{{tool replace_instance}}` for an instance correction. Use the instance ID that the tool returns.
4. Use the reachability in the result. Do not probe the target yourself. Read and report the assumptions. If a data policy is missing, ask how the environment resets or isolates test data. Use the person's policy or reset command. Do not invent a policy, reset, or cleanup hook.
5. If a result refuses the action, read its reasons and next action. Correct values you can verify. Ask for a decision only when the person must supply it.

Report the target, instance, and readiness. Stop here for a setup-only request. For a custom target with named entry points or a factory startup contract, use the factory setup workflow.
