---
name: update-model-policy
description: Keep model selection and authentication with the host CLI.
---

Read `plugin/src/launcher.ts`, `plugin/src/hosts.ts`, and the workflow skills before changing host integration.
Use ASD-STE100 style for instructions and documentation.

Use the installed host CLI: Claude Code, Codex, or pi. Keep model selection, credentials, context, tools, and native permissions with the host.
Do not add a custom provider client, retry loop, token budget, or price estimate.
Do not extract subscription credentials. Use supported host authentication.
Do not add a permission bypass to make a test pass.
Do not hide a host that cannot enforce rules. Require `--unrestricted-host` and record it.

Read the stage answer from the response file. Read the host output only for failure and model name.
Validate structured output locally. Check pinned files and evidence before finalization.
Test missing authentication, denied permission, invalid output, and interruption for each host.
Run live integration tests when host authentication is available. Report unrun checks.
