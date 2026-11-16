# Architecture

Checkmate is a Claude Code plugin and a deterministic Node.js toolkit. It keeps the QA record of a change: a journal of entries. The agent explores freely. Checkmate does not restrict how the agent tests.

`plugin/` is the installed plugin. It has no npm dependencies.

- `plugin/skills/qa/` tells an agent when to use Checkmate and how to start. `plugin/skills/ui/` starts the review UI. All real guidance is in the output of `checkmate guide`.
- `plugin/contracts/` contains the authoritative JSON Schemas: the target profile, the instance, and the journal entries.
- `plugin/src/contracts.ts` checks the documents and has the refusal type.
- `plugin/src/store.ts` owns the SQLite database, transactions, and the operation log. `createStore` creates a store. `openStore` refuses a missing store.
- `plugin/src/targets.ts` owns the commands for targets and their instances.
- `plugin/src/journal.ts` owns `open`, `log`, `gaps`, `show`, `answer`, `accept`, `reject`, `export`, `merge`, `issues`, and `verify`. It stores a change in `changes` and each entry in `journal_entries`, with its actor. It derives the gaps, the views of each actor, and the merged issues in code.
- `plugin/src/guide.ts` prints `guide` from the journal entry schemas, for the roles tester, merger, and verifier.
- `plugin/src/views.ts` has the read model of the operation log. `plugin/src/actor.ts` finds the default actor.
- `plugin/src/cli.ts` finds the workspace, parses arguments, and prints compact or JSON output. Only `init` and `target open` create a store. `plugin/dist/checkmate.js` is its bundle.
- `plugin/src/ui/` is the review UI: a `node:http` server on `127.0.0.1`, the log page, the Settings pages for targets and instances, and the assets. `checkmate ui` starts it. It does not show the journal yet.
- `plugin/src/types.ts` and `plugin/src/validators.js` are generated from the schemas.

`cli/` is the npm package `@xoxoai/checkmate`. `cli/src/main.ts` runs the plugin CLI.

The repository root contains tests, scripts, documentation, and development tools.

The host owns the agent loop, model, authentication, context, tools, and permissions. Checkmate does not start agents. Checkmate owns its contracts, its entry checks, and its derived views. These checks are not a sandbox.

Guidance stays descriptive: what the record holds and how to write an entry. It does not tell the agent how to test.
