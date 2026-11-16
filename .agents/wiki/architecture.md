# Architecture

Checkmate is a Claude Code plugin and a deterministic Node.js toolkit. It keeps the QA record of a change: a journal of entries. The tester explores freely and does not talk to Checkmate. After the test session, `checkmate record` starts a recorder: a fork of the test session that writes the record.

`plugin/` is the installed plugin. It has no npm dependencies.

- `plugin/skills/qa/` tells the person or the orchestrator how to open a change and how to record a test session. `plugin/skills/ui/` starts the review UI. All real guidance is in the output of `checkmate guide`.
- `plugin/contracts/` contains the authoritative JSON Schemas: the target profile, the instance, and the journal entries.
- `plugin/src/contracts.ts` checks the documents and has the refusal type.
- `plugin/src/store.ts` owns the SQLite database, transactions, and the operation log. `createStore` creates a store. `openStore` refuses a missing store.
- `plugin/src/targets.ts` owns the commands for targets and their instances.
- `plugin/src/journal.ts` owns `open`, `log`, `gaps`, `show`, `answer`, `accept`, `reject`, `export`, `merge`, `issues`, and `verify`. It stores a change in `changes` and each entry in `journal_entries`, with its actor. It derives the gaps, the views of each actor, and the merged issues in code.
- `plugin/src/guide.ts` prints `guide` from the journal entry schemas, for the roles tester, merger, and verifier. The role recorder prints the recorder prompt.
- `plugin/hooks/hooks.json` has one `SessionEnd` hook. It runs `record-hook` (in `plugin/src/cli.ts`), which starts `record` detached for a session that has `CHECKMATE_RECORD`.
- `plugin/src/recorder.ts` owns `record`: it finds the test session, takes a lock for the change, starts one `claude -p --resume <session> --fork-session` with the recorder prompt, takes the JSON array from the reply of the recorder, gives new IDs to entries whose IDs the record has, keeps missing evidence paths as text, logs the array, resumes the recorder one time to fix refused entries, and counts the entries that it added.
- `plugin/src/views.ts` has the read model of the operation log. `plugin/src/actor.ts` finds the default actor.
- `plugin/src/cli.ts` finds the workspace, parses arguments, and prints compact or JSON output. Only `init` and `target open` create a store. `plugin/dist/checkmate.js` is its bundle.
- `plugin/src/ui/` is the review UI: a `node:http` server on `127.0.0.1`, the Changes and change pages (`changes.ts`), the log page, the Settings pages for targets and instances, and the assets. `checkmate ui` starts it. The change page reads `changeRecord`, `changeGaps`, and the `record` operations. Its forms call `answerQuestion` and `decideBuild`.
- `plugin/src/types.ts` and `plugin/src/validators.js` are generated from the schemas.

`cli/` is the npm package `@xoxoai/checkmate`. `cli/src/main.ts` runs the plugin CLI.

The repository root contains tests, scripts, documentation, and development tools.

The host owns the agent loop, model, authentication, context, tools, and permissions. Checkmate starts no tester. `record` starts one recorder with the `claude` command of the host. It passes no model and no credential. It gives the recorder no permission (`--permission-prompts none`, no `--allowedTools`) and keeps the tool list of the host, so that the recorder reads the prompt cache of the test session. The recorder replies with the entries in one round, and Checkmate logs them. Checkmate owns its contracts, its entry checks, and its derived views. These checks are not a sandbox.

Guidance stays descriptive: what the record holds and how to write an entry. It does not tell the agent how to test.

## Why the tester does not log

An agent that must log while it tests spends its attention on the record. It tests less and finds fewer defects. A fork of the test session has the full memory of the test work, so it can write the complete record after the test, and the test session stays unchanged.
