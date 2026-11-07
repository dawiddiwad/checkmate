# Architecture

Checkmate is a Claude Code plugin and a deterministic Node.js toolkit.

`plugin/` is the installed plugin. It has no npm dependencies.

- `plugin/skills/` contains setup, plan, revise, execute, and report workflows.
- `plugin/contracts/` contains authoritative JSON Schemas.
- `plugin/src/contracts.ts` checks document shape and plan relationships.
- `plugin/src/stages.ts` owns profile publication, plan coverage, revisions, execution gates, evidence digests, and result finalization.
- `plugin/src/files.ts` owns path checks, digests, and exclusive writes.
- `plugin/src/launcher.ts` starts the installed Claude CLI, checks its structured response, and reads the candidate it named.
- `plugin/src/render.ts` generates Markdown and HTML views.
- `plugin/src/types.ts` and `plugin/src/validators.js` are generated from the schemas.

The repository root contains tests, scripts, documentation, and development tooling.

The host owns the agent loop, model, authentication, context, tools, and permissions. Checkmate owns its contracts and artifact checks. These checks are not a sandbox.

The caller owns scope, decisions, application fixes, and release decisions. Target content cannot authorize a change to the request or plan.
