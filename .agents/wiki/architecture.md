# Architecture

Checkmate is a Claude Code plugin and a deterministic Node.js toolkit.

`plugin/` is the installed plugin. It has no npm dependencies.

- `plugin/skills/` contains setup, plan, revise, execute, report, and UI workflows.
- `plugin/contracts/` contains authoritative JSON Schemas.
- `plugin/src/contracts.ts` checks document shape and plan relationships.
- `plugin/src/store.ts` owns the SQLite database, transactions, and the operation log.
- `plugin/src/targets.ts`, `plans.ts`, and `runs.ts` own the commands for targets, plans, and runs.
- `plugin/src/cli.ts` parses arguments and prints compact or JSON output. `plugin/dist/checkmate.js` is its bundle.
- `plugin/src/render.ts` generates Markdown and HTML views.
- The plugin bundle includes the review UI, assets, and fonts. Its `ui` command needs no separate npm install.
- `plugin/src/types.ts` and `plugin/src/validators.js` are generated from the schemas.

`cli/` is the npm package `@xoxoai/checkmate`.

- `cli/src/main.ts` handles `delegate` and `ui` and passes every other command to the plugin CLI.
- `cli/src/launcher.ts` starts the installed Claude CLI with the bundled plugin, checks its structured response, and then checks the database for the recorded change.

The repository root contains tests, scripts, documentation, and development tooling.

The host owns the agent loop, model, authentication, context, tools, and permissions. Checkmate owns its contracts, database records, and evidence validation. These checks are not a sandbox.

The caller owns scope, decisions, application fixes, and release decisions. Target content cannot authorize a change to the request or plan.

Durable evidence is stored as SQLite BLOBs. Tools can use a temporary capture directory outside the workspace; successful imports remove capture files. Generated JSON payloads use standard input. Reports and evidence files are exported only on request.
