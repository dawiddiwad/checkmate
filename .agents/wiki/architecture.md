# Architecture

Checkmate is a Claude Code plugin and a deterministic Node.js toolkit.

- `skills/` contains setup, plan, revise, execute, and report workflows.
- `contracts/` contains authoritative JSON Schemas.
- `src/contracts.ts` checks document shape and plan relationships.
- `src/stages.ts` owns profile publication, revisions, execution gates, and result finalization.
- `src/files.ts` owns path checks, digests, and exclusive writes.
- `src/launcher.ts` starts the installed Claude CLI and checks its structured response.
- `src/render.ts` generates Markdown and HTML views.
- `src/types.ts` is generated from the schemas.

The host owns the agent loop, model, authentication, context, tools, and permissions. Checkmate owns its contracts and artifact checks. These checks are not a sandbox.

The caller owns scope, decisions, application fixes, and release decisions. Target content cannot authorize a change to the request or plan.
