---
name: update-model-policy
description: Keep model selection and authentication with the Claude Code host.
---

Read `src/launcher.js` and the workflow skills before changing host integration.
Use ASD-STE100 style for instructions and documentation.

Use the installed Claude Code CLI. Keep model selection, credentials, context, tools, and native permissions with the host.
Do not add a custom provider client, retry loop, token budget, or price estimate.
Do not extract subscription credentials. Use supported host authentication.
Do not add a permission bypass to make a test pass.

Validate structured output locally. Check pinned files and evidence before finalization.
Test missing authentication, denied permission, invalid output, and interruption.
Run live integration tests when host authentication is available. Report unrun checks.
