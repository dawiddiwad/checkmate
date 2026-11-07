---
name: setup
description: Set up a Checkmate target profile from an explicit setup request. Check tools and access. Preserve local choices.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.
Read `contracts/setup-request.schema.json` and `contracts/profile.schema.json` in the plugin.

Before you call the Checkmate CLI, check for the plugin dependency `ajv`. If it is missing and dependency installation is authorized, run `npm ci --omit=dev` in `${CLAUDE_PLUGIN_ROOT}`. Otherwise return `needs_decision` and identify the missing dependency.

1. Read the caller's setup request. Inspect project instructions and existing profiles. Source code is optional.
2. Check for Node.js 24.12.0 or later. Check Claude Code and the requested tools. In `tooling`, record exactly one entry for each requested capability. Use `browser` for Playwright CLI and `http` for Node.js. Do not add an extra Claude capability. Record actual versions.
3. Use the caller's running application. Start it only if the caller authorized a startup command.
4. Check target access with a read-only request. Do not invent authentication or install packages without authorization.
   For the browser capability, open `about:blank` in a temporary isolated session with the caller's browser config. Close that session after the check.
5. Write a profile candidate. Preserve the requested target, URL, capabilities, and allowed operations. Use revision 1 for a new profile. Use a new path and revision for a changed profile.
6. Set `readyForLiveExecution` to true only after the required tool and target checks pass. Record missing prerequisites in the cleanup or tooling guidance and return them to the caller.
7. Publish with `checkmate setup`, unless the parent requested a candidate only.

If the profile already exists, preserve it. Identical setup is safe to repeat. Do not overwrite deliberate local choices.
For browser setup, read `${CLAUDE_PLUGIN_ROOT}/references/browser.md`.
