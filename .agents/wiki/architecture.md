# Architecture

Checkmate is a Claude Code plugin and a deterministic Node.js toolkit.

`plugin/` is the installed plugin. It has no npm dependencies.

- `plugin/skills/` contains the setup, plan, revise, execute, report, status, and ui workflows.
- `plugin/references/workflow.md` has the shared stage rules: read state first, actor, modes, and the report format. `browser.md` and `http.md` are optional tool recipes.
- `plugin/contracts/` contains authoritative JSON Schemas.
- `plugin/src/contracts.ts` checks document shape and plan relationships.
- `plugin/src/store.ts` owns the SQLite database, transactions, and the operation log.
- `plugin/src/targets.ts`, `plans.ts`, and `runs.ts` own the commands for targets and their instances, plans, and runs.
- `plugin/src/views.ts` has the read models for the inbox, the lists, the detail pages, and the loop status of a plan. `plugin/src/actor.ts` finds the default actor.
- `plugin/src/cli.ts` parses arguments and prints compact or JSON output. `plugin/dist/checkmate.js` is its bundle.
- `plugin/src/render.ts` generates the Markdown, HTML, and JSON exports.
- `plugin/src/ui/` is the review UI: a `node:http` server on `127.0.0.1`, the pages, and the assets. `ui/settings.ts` has the Settings pages. `checkmate ui` starts it.
- `plugin/src/types.ts` and `plugin/src/validators.js` are generated from the schemas.

`cli/` is the npm package `@xoxoai/checkmate`.

- `cli/src/main.ts` handles `delegate` and passes every other command to the plugin CLI.
- `cli/src/launcher.ts` starts the installed Claude CLI with the bundled plugin, checks its structured response, and then checks the database for the recorded change.

The repository root contains tests, scripts, documentation, and development tools.

The host owns the agent loop, model, authentication, context, tools, and permissions. Checkmate records the tools of a target and a plan, and owns its contracts and record checks. These checks are not a sandbox.

The oracle owns scope, decisions, and release decisions. The factory owns application startup and fixes. Target content cannot authorize a change to the request or plan.
