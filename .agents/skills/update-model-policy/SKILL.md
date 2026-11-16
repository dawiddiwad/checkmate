---
name: update-model-policy
description: Keep authentication and permissions with the Claude Code host, and keep model aliases in the level table.
---

Read `cli/src/launcher.ts`, `plugin/src/sessions.ts`, `plugin/src/levels.ts`, and the workflow skills before you change host integration.
Use ASD-STE100 style for instructions and documentation.

Use the installed Claude Code CLI. Keep credentials, context, tools, and native permissions with the host.
Put each default model in `plugin/src/levels.ts` as a Claude Code alias, for example `haiku`. Pass it as `--model <alias>`. Do not write a full model ID in another file.
Apply a level model only to the sessions that Checkmate starts. An explicit `--claude-arg --model <model>` of the host wins. Do not give a model to a delegated stage unless the host gives one.
Give the recorder of a session the same model as that session.
When the host refuses a model, fail and name the override in the hint. Do not try another model.
Do not add a custom provider client, retry loop, token budget, or price estimate.
Do not extract subscription credentials. Use supported host authentication.
Do not add a permission bypass to make a test pass.

Validate structured output locally. Check pinned files and evidence before finalization.
Test missing authentication, denied permission, invalid output, and interruption.
Run live integration tests when host authentication is available. Report unrun checks.
