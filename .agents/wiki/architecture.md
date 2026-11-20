# Architecture

Checkmate includes a Claude Code plugin, a Pi package, and a deterministic Node.js toolkit. The workspace setting selects the host for new work. A CLI caller can override it with `CHECKMATE_HARNESS`. The UI uses the startup environment until a person saves a choice. Claude Code is the default, and the Pi extension starts the UI with Pi as the default. Pi owns its provider configuration and model selection. `plugin/src/pi.ts` builds Pi arguments and reads its event stream. `cli/extensions/checkmate.mjs` registers the Pi commands and starts the review UI. `cli/skills/checkmate/` defines the interactive workflow.

`plugin/` is the installed plugin. It has no npm dependencies.

- `plugin/skills/` contains the test, setup, plan, revise, execute, report, status, and ui workflows. `test` is the main entry. `plugin/src/modes.ts` has the `test` command and its mode rule.
- `plugin/references/workflow.md` has the stage rules that every stage reads: commands, actor, return, and safety. `session.md` has the same-session rules: read state first, modes, recording a request, beginning a run, and the report format. `browser.md` and `http.md` are optional tool recipes.
- `plugin/contracts/` contains authoritative JSON Schemas.
- `plugin/src/contracts.ts` checks document shape and plan relationships.
- `plugin/src/store.ts` owns the SQLite database, transactions, and the operation log.
- `plugin/src/targets.ts`, `plans.ts`, and `runs.ts` own the commands for targets and their instances, plans, and runs.
- `plugin/agents/` contains the `tester` and `clerk` agents of the session path. A Claude Code session starts them with the Agent tool.
- `plugin/src/explorations.ts` owns explorations and their events. `journal.ts` owns the entries that recorders log. `recorder.ts` forks a test session to write its record. `explorers.ts` starts the explorers and the supervisor. `sessions.ts` builds the clean-context arguments of each child session, with the permission and activity hooks when `.checkmate/ui.json` names a live UI. `permissions.ts` owns the permission requests of testers and of requests, their answers, and the rules of an exploration or of a conversation. `requests.ts` owns the free-form requests of the find bar: their records, their conversation, and the changes that each made. `briefs.ts` has the text that these sessions get. `levels.ts` has the test levels. `agents.ts` has the session path: the actions for the agents of a host session, and the results of those agents. `harvest.ts` turns the claims of an exploration into stored tests. `rules.ts` owns the rules of a plan: the derived rules, their check, and their correction.
- `plugin/src/views.ts` has the read models for the inbox, the lists, the detail pages, and the loop status of a plan. `rulemap.ts` has the rule map of a plan and the details of its claims. `plugin/src/actor.ts` finds the default actor.
- `plugin/src/cli.ts` parses arguments and prints compact or JSON output. `plugin/dist/checkmate.js` is its bundle.
- `plugin/src/render.ts` generates the Markdown, HTML, and JSON exports.
- `plugin/src/ui/` is the review UI: a `node:http` server on `127.0.0.1`, the pages, and the assets. `ui/settings.ts` has the Settings pages. `ui/hooks.ts` has the hook routes that the sessions of a run and of a request call: it holds each permission request until a person answers, and keeps the activity line of each tester. `ui/requester.ts` runs the requests: one request at a time in the selected harness, with Claude stream JSON or Pi RPC. `checkmate ui` starts it.
- `plugin/src/types.ts` and `plugin/src/validators.js` are generated from the schemas.

`cli/` is the npm package `@xoxoai/checkmate`.

- `cli/src/main.ts` handles `delegate` and passes every other command to the plugin CLI.
- `cli/src/launcher.ts` starts the selected coding harness with the stage instructions, checks its structured response, and then checks the database for the recorded change.

The repository root contains tests, scripts, documentation, and development tools.

The host owns the agent loop, authentication, credentials, context, tools, and permissions. For Claude Code, Checkmate names a default model alias for the sessions that it starts: explorers, recorders, the merger, and the verifier. On the session path, the front matter of each agent in `plugin/agents/` names the model. The workspace tester model overrides the level default. A run can set a model for each tester. Its recorder uses the same model. The merger and verifier use the run model. An explicit CLI model takes precedence. The UI discovers models from the selected host through `plugin/src/model-catalog.ts`. The delegated stages get no model argument unless the host gives one. A request from the find bar uses the workspace request model when set. Otherwise it uses the host configuration or the Pi startup model. It has the tools of the host session. Checkmate records the tools of a target and a plan, and owns its contracts and record checks. These checks are not a sandbox.

The oracle owns scope, decisions, and release decisions. The factory owns application startup and fixes. Target content cannot authorize a change to the request or plan.
