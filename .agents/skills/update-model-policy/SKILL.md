---
name: update-model-policy
description: Keep model selection and authentication with the Claude Code host.
---

Read `plugin/skills/` and `plugin/src/cli.ts` before changing host integration.
Use ASD-STE100 style for instructions and documentation.

Checkmate does not start Claude. Keep model selection, credentials, context, tools, and native permissions with the host.
Do not add a custom provider client, retry loop, token budget, or price estimate.
Do not extract subscription credentials. Use supported host authentication.
Do not add a permission bypass to make a test pass.
Do not add a rule that limits how the agent tests.

Report unrun checks. Do not claim that mocked output proves live Claude behavior.
