# Architecture

Checkmate is an agent plugin and a deterministic Node.js toolkit. It works with Claude Code, Codex, and pi.

`plugin/` is the installed plugin. It has no npm dependencies. `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` describe it to Claude Code and Codex. The `pi` key in `plugin/package.json` describes it to pi.

- `plugin/skills/` contains the `checkmate-setup`, `checkmate-plan`, `checkmate-revise`, `checkmate-execute`, and `checkmate-report` workflows. The skills use only paths relative to the plugin root.
- `plugin/contracts/` contains authoritative JSON Schemas.
- `plugin/src/contracts.ts` checks document shape and plan relationships.
- `plugin/src/stages.ts` owns profile publication, plan coverage, revisions, execution gates, evidence digests, and result finalization.
- `plugin/src/files.ts` owns path checks, digests, and exclusive writes.
- `plugin/src/launcher.ts` starts one headless host session, applies the deadline, and reads the response and candidate files that it named.
- `plugin/src/hosts.ts` contains one adapter for each host CLI. An adapter builds the command line and reads the host output for failure and model name.
- `plugin/src/render.ts` generates Markdown and HTML views.
- `plugin/src/types.ts` and `plugin/src/validators.js` are generated from the schemas.

The repository root contains tests, scripts, documentation, and development tooling.

The host owns the agent loop, model, authentication, context, tools, and permissions. Each result records the host that produced it. Checkmate owns its contracts and artifact checks. These checks are not a sandbox.

The caller owns scope, decisions, application fixes, and release decisions. Target content cannot authorize a change to the request or plan.
