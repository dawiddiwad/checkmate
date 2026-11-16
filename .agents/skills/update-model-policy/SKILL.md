---
name: update-model-policy
description: Keep model selection and authentication with the Claude Code host.
---

Read `plugin/skills/` and `plugin/src/cli.ts` before changing host integration.
Use ASD-STE100 style for instructions and documentation.

Checkmate starts no tester. Only `checkmate record` starts Claude: one `claude -p` fork of a test session, in `plugin/src/recorder.ts`. Keep model selection, credentials, context, tools, and native permissions with the host.
Do not pass a model, a credential, or a permission mode to the recorder. Allow only the Checkmate CLI, `Read`, and `Write` in the folder of the recorder.
Do not add a custom provider client, retry loop, token budget, or price estimate.
Do not extract subscription credentials. Use supported host authentication.
Do not add a permission bypass to make a test pass.
Do not add a rule that limits how the agent tests.

Report unrun checks. Do not claim that mocked output proves live Claude behavior.
