---
name: update-model-policy
description: Keep authentication and permissions with the Claude Code host, and keep model aliases in the level table.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Read `cli/src/launcher.ts`, `plugin/src/sessions.ts`, `plugin/src/levels.ts`, and the workflow skills before you change host integration.
Use ASD-STE100 style for instructions and documentation.

Use the installed Claude Code CLI. Keep credentials, context, tools, and native permissions with the host.
Put each default model in `plugin/src/levels.ts` as a Claude Code alias, for example `haiku`. Pass it as `--model <alias>`. Do not write a full model ID in another file.
Apply a level model only to the sessions that Checkmate starts. An explicit `--claude-arg --model <model>` of the host wins.
A delegated stage has no level model. It uses the saved workspace model of its setting: the tester model for execute workers and probes, and the request model for setup, plan, and revise. An empty setting uses the harness default. An explicit host model wins over the setting.
Give the recorder of a session the same model as that session.
On the session path, put the default model in the front matter of each agent in `plugin/agents/`. The operator gives another model only as the `model` parameter of the Agent tool, when the person asks for it.
When the host refuses a model, fail and name the override in the hint. Do not try another model.
The one exception is a saved model on the delegated path. When the host refuses it before the worker writes, run the worker again on the harness default once, and use the default for the rest of that delegate call. Say so in the reply and in the recorded attempt. Do not run a worker again when it can have written.
Do not add a custom provider client, retry loop, token budget, or price estimate.
Do not extract subscription credentials. Use supported host authentication.
Do not add a permission bypass to make a test pass.

Validate structured output locally. Check pinned files and evidence before finalization.
Test missing authentication, denied permission, invalid output, and interruption with controlled hosts.
Run a live integration test only when it is needed and authorized; host authentication alone does not authorize a potentially paid run. Report unrun checks.
